# Audit Prompt — Capability Gates: Tags vs. Hardcoded Item IDs

A reusable prompt for finding **capability checks that hardcode a specific item id instead of reading a
tag**. The tag system ([tags.md](../tags.md)) exists so the engine and plugins reason about *what an item
does*, never *which exact item it is*. When a gate asks "does the player have `item_hack_deck`?" instead of
"does the player carry something tagged as a hacking device?", it silently couples a mechanic to one
database row. Nothing errors — the check works for that one item — so the coupling is invisible until a
designer authors a second item that *should* satisfy the gate and finds it doesn't.

This is a real, shipped instance. Breaching a HoloLock is gated three separate times on the literal id
`item_hack_deck`:

- [`server/engine/commands/doors.js:291`](../../server/engine/commands/doors.js#L291) — `HACK_DEVICE_ITEM_ID = 'item_hack_deck'`, checked by `hasHackDevice()` for the door hack.
- [`plugins/atm/index.js:12`](../../plugins/atm/index.js#L12) — its own copy of the same id and its own `hasHackDevice()` for ATM jacking.
- [`plugins/jail/index.js:33`](../../plugins/jail/index.js#L33) — the same id again for hacking the cell door.

Three copies of one id answering the same conceptual question ("does this player have a hacking device?").
Meanwhile the *same lock domain* already models capability the right way: `registerLockType` gives each
lock a `kitTag` (e.g. `lockkit:hololock`), and the `install` verb gates on that **tag**
([`doors.js:490`](../../server/engine/commands/doors.js#L490), `WHERE (i.tags ? $2)`). So the codebase
proves the tag path is the intended one — the hack gate simply never adopted it. The failure mode: author
a shinier hacking deck, tag it however you like, and it will *not* open doors, because the gate only knows
one id. No error tells you why.

This is the engine/plugin source-of-truth bug ([source-of-truth-audit.md](source-of-truth-audit.md))
projected onto the **capability ↔ item** seam: the source of truth for "can do X" should be a tag on the
content, not an id embedded in code.

## The distinction that makes this audit reliable

Not every hardcoded item id is a defect. Two cases, and only one is:

- **Capability / role gate (defect).** Code asks "does the player *have the ability* to do X?" and answers
  it by naming a specific item id. Hacking, lockpicking, cutting, welding, any "you need a ⟨kind of tool⟩"
  message. The right form is a tag: `you need something tagged `hack_device``, satisfied by *any* item the
  designer tags that way. **These are what this audit hunts.**
- **Concrete-item reference (fine).** Code grants, spawns, removes, or crafts *one specific item by
  identity* — starter gear, a named quest object, a recipe's exact output. There is no "kind of" here; the
  id **is** the thing. `plugins/dev-tools` handing out `item_cat_boxers`, `gameLoop` spawning
  `item_basic_shirt` as respawn clothing, `graph.js` `GRANT_ITEM {item_id}` — all legitimate. An id is the
  correct key when you mean *that row*, wrong when you mean *that capability*.

The litmus test: **"If a designer made a second item that should also work here, would they expect it to
just work by tagging it?"** Yes → it's a capability gate, and a hardcoded id is the bug. No (they mean this
exact item) → an id is correct.

## How to run

Scope to **one plugin or one engine command file at a time** — never "all hardcoded ids at once." The
cross-referencing (is this gate a capability check or a concrete reference?) is the work, and it only stays
reliable when focused. Start with the plugins that gate tool-use: `doors`, `atm`, `jail`, `synthesis`,
`burglary`, `thievery`.

---

## Prompt

> You are auditing the Architect MUD codebase for **capability gates that hardcode an item id instead of
> reading a tag**. Background to internalize first: item behavior lives in the tag system
> ([tags.md](../tags.md)); `client/shared/tagCatalog.js` (`TAG_CATALOG`) is the declared source of truth,
> read via `server/engine/tags.js` (`hasTag`, `tagValue`, `hasFlag`) or, for "does the player carry
> something tagged X", a `player_inventory` ⋈ `items` join filtered with `(i.tags ? '<tag>')`. The design
> rule (CLAUDE.md "Engine vs. content are separate", [tags.md](../tags.md)): **a plugin should look for a
> tag, not a specific item.** The canonical violation is `item_hack_deck`, hardcoded in
> `server/engine/commands/doors.js`, `plugins/atm/index.js`, and `plugins/jail/index.js` to gate hacking,
> while the parallel `kitTag` system (`lockkit:*`) already gates lock *installation* by tag.
>
> Audit scope: **<NAME ONE PLUGIN OR ENGINE COMMAND FILE, e.g. "plugins/atm">**. Do this:
>
> 1. **Enumerate hardcoded item ids.** Grep the scope for string literals matching `item_[a-z0-9_]+` (and
>    any const like `*_ITEM_ID`). List each with its line and the surrounding check.
>
> 2. **Classify each: capability gate or concrete reference.** For each id, ask the litmus test — *if a
>    designer authored a second item that should also satisfy this, would they expect tagging it to be
>    enough?* Yes → **capability gate (defect)**. No, this means that exact row (grant/spawn/remove/craft a
>    specific item) → **concrete reference (fine)**, note it and move on.
>
> 3. **For each capability gate, name the tag it should read.** Check `TAG_CATALOG` for an existing tag
>    that expresses the capability (e.g. a `hack_device` tag). If one exists, the gate should use it. If
>    none exists, the fix is two-part: add the tag to the catalog **and** switch the gate to read it. State
>    which.
>
> 4. **Find the duplicates.** A capability gated in one place by id is usually gated the same way
>    elsewhere (the `item_hack_deck` trio). Grep the whole repo for the id; list every gate. They must all
>    converge on the same tag — a partial migration (doors read the tag, ATM still reads the id) is its own
>    silent drift.
>
> 5. **Prove it's a real coupling, not theory.** For one capability gate: author a *second* item via the
>    dev panel (or a scratch `query()`), give it the tag the mechanic *should* accept but not the hardcoded
>    id, put it in a test player's inventory, and show the mechanic rejects it over the WebSocket. Then
>    show that the one blessed id works. That is the coupling, demonstrated.
>
> 6. **Report**, per finding: file · line · the id · capability or concrete? · the tag it should read (and
>    whether that tag exists in the catalog) · every other site sharing the id · the minimal fix (switch
>    the gate to a tag join / `hasTag`, add the catalog entry if missing, and dedupe the copies into one
>    helper). Keep changes surgical (CLAUDE.md): don't redesign the item, don't add a boot-time migration,
>    and when introducing a new tag, add it to `TAG_CATALOG` so the editor and next reader can see it.

---

## Standardization this audit should push toward

- **Capabilities are tags; ids are identities.** Any "you need a ⟨tool⟩ to do X" gate reads a tag. Only
  grant/spawn/remove/craft of a *named* item may key on an id. Treat a capability gate keyed on an id as a
  defect even when it currently works — it's invisible to the designer and un-extendable by content.
- **One capability, one tag, one reader.** The `item_hack_deck` trio should become a single `hack_device`
  tag read through one shared helper (e.g. `playerHasItemWithTag(playerId, 'hack_device')`), not three
  copies of an id. Duplicated gates are duplicated sources of truth — the very bug
  [source-of-truth-audit.md](source-of-truth-audit.md) hunts.
- **New capability tags land in the catalog.** If a gate reads a tag, that tag must be in `TAG_CATALOG`
  ([content-engine-field-audit.md](content-engine-field-audit.md) makes this law for tags generally).

## Checklist (quick manual version)

- [ ] Read [tags.md](../tags.md) and the scope file(s); note the `kitTag`/`item_hack_deck` precedent.
- [ ] Grep the scope for `item_[a-z0-9_]+` literals and `*_ITEM_ID` consts.
- [ ] Classify each: capability gate (defect) vs concrete-item reference (fine) via the litmus test.
- [ ] For each capability gate, name the tag it should read; does it exist in `TAG_CATALOG`?
- [ ] Grep the whole repo for each capability id — list every duplicate gate.
- [ ] Prove one coupling live: a correctly-tagged second item is wrongly rejected before changing code.
- [ ] Fix = tag read + catalog entry (if new) + dedupe copies into one helper; record the tag in tags.md.
