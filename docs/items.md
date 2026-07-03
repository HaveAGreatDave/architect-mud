# Item Properties Reference

How items are defined and what every behavior does. As of the tag-system
cutover, **all item behavior lives in a single `tags` JSONB column** and is
described by one shared catalog. This doc explains that model; the catalog
itself (`client/shared/tagCatalog.js`) is the machine-readable source of truth.

Items are content, not code: they live in the `items` table and are edited
through the dev panel's **🗡 Items** editor. Nothing here requires a deploy.

---

## The model in one paragraph

An item is identity/economy columns plus a bag of **tags**. A class tag has a
name and an optional value; `true` for valueless markers. The engine reads
behavior *only* from tags. There is no more `type`/`subtype` routing, no
`effects`/`stat_modifiers`/`requirements`/`flags` blobs, and no `is_*` boolean
columns — every one of those collapsed into a tag. The catalog documents what
each tag does, so nothing gets silently forgotten as the list grows.

---

## The `items` Table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | e.g. `item_scrap_armor` |
| `name` | TEXT | Display name. Commands fuzzy-match on this (`ILIKE %name%`). |
| `weight` | REAL | Carry weight, **in grams**. Default 1000 (1kg). Displayed as `g` below 1000g, else `kg` (e.g. `750g`, `1.5kg`). |
| `value` | INTEGER | Base price; vendors mark up/down from this. |
| `tags` | JSONB | **Everything the item *does*.** A map of tag name → value. |

> The legacy columns (`description`, `type`, `subtype`, `is_stackable`,
> `is_unique`, `is_quest_item`, `effects`, `stat_modifiers`, `requirements`,
> `flags`) are migrated into `tags` by `migrate.js`. They are dropped in a
> separate later commit once the cutover is verified; until then they still
> exist but are unused.

---

## The Tag Catalog

`client/shared/tagCatalog.js` exports `TAG_CATALOG`, a map of
tag name → `{ label, shape, scope, group, help, options? }`. It is the single
source of truth: the dev panel builds its editor widgets from it, and the
engine reads behavior through `server/engine/tags.js` (`hasTag`, `tagValue`,
`hasFlag`, and a re-export of the catalog). See [tags.md](tags.md) for the full
tag model and the rationale behind it.

`shape` drives both the editor widget and how the value is stored:

| shape | value | editor widget |
|---|---|---|
| `text` | string | textarea |
| `flag` | `true` | presence chip (no input) |
| `int` | integer | number |
| `enum` | one of `options` | select |
| `range` | `{ min, max }` | two numbers |
| `hot` | `{ amount, duration_seconds }` | two numbers |
| `statmap` | `{ key: number, … }` | small JSON textarea |

`scope` is `class` (on the item template, in `items.tags`) or `instance`
(presence-only flag on a *carried* item, in `player_inventory.custom_data`).

---

## Class Tags (taxonomy)

| Tag | Shape | What it does |
|---|---|---|
| `description` | text | Shown on examine / look. Always present in the editor. |
| `quest_item` | flag | Cannot be dropped or sold. |
| `unique` | flag | Prevents stacking. Items merge into one quantity row by default; tag Unique to keep each as its own row. |
| `weapon` | flag | Marks the combat weapon. The equipped item with this tag is used when you attack. |
| `consumable` | flag | Usable via `use`/`eat`/`drink`; gates the consumable path. |
| `drug` | flag | Drug marker (visibility/flavor). Mechanics still come from the `drugs` table joined by `item_id`. |
| `material` / `currency` / `misc` | flag | Category markers (filtering/flavor). |
| `slot` | enum | `head`·`torso`·`hands`·`legs`·`feet`·`weapon_hand`·`accessory`. **Presence of this tag is what makes an item equippable.** |
| `armor` | int | Flat damage reduction while equipped. Stacks across worn pieces. |
| `stat_bonus` | statmap | Passive stat bumps, e.g. `{ "stat_str": 3 }`. |
| `requires` | statmap | Stat gates to equip, e.g. `{ "stat_str": 6 }`. |
| `damage` | range | Weapon damage roll `{ min, max }`. |
| `weapon_skill` | enum | `blunt`·`bladed`·`energy` — routes attack XP. |
| `status_chance` | statmap | On-hit status, e.g. `{ "stunned": 0.3 }`. |
| `restore_hp` / `restore_hunger` / `restore_thirst` / `restore_radiation` / `restore_sanity` | int | Consumable stat changes (can be negative). |
| `grants_credits` | int | Credits granted on use (credit chips). |
| `heal_over_time` | hot | Gradual heal `{ amount, duration_seconds }`, ticks once/min, stacks. |
| `well_fed` | flag | Grants the Well-Fed buff (faster HP regen), 10 min. |
| `hydrating` | flag | Grants the Hydrated buff (faster radiation decay), 10 min. |
| `container` | int | Marks the item as a container; value is the max total weight it can hold. See **Containers** below. |

### Name-collision note

Equip-eligibility is signaled by the **presence of a `slot` tag**, not by
`weapon`/`armor`. `armor` is purely the integer damage-reduction tag, and
`weapon` is purely the combat-weapon marker. A weapon therefore carries *both*
`weapon` and `slot: "weapon_hand"`.

---

## Instance Flags

Presence-only flags on a single carried item, stored in
`player_inventory.custom_data` (already JSONB). Currently `broken` and
`cursed`. Written by game logic as `custom_data.<flag> = true` and read with
`hasFlag(invRow, name)`.

---

## Worked Examples

```jsonc
// Weapon — Pipe Wrench
{ "description":"Heavy. Reliable. Pre-used.", "weapon":true, "weapon_skill":"blunt",
  "slot":"weapon_hand", "damage":{"min":4,"max":9}, "stat_bonus":{"stat_str":3} }

// Energy weapon with on-hit status — Custodian Taser
{ "weapon":true, "weapon_skill":"energy", "slot":"weapon_hand",
  "damage":{"min":5,"max":8}, "status_chance":{"stunned":0.3}, "stat_bonus":{"stat_agi":4} }

// Armor piece — Scrap Helmet (head). Add `"armor": N` for damage reduction.
{ "description":"A motorcycle helmet with extra rivets.", "slot":"head" }

// Gradual heal — Trauma Kit
{ "consumable":true, "heal_over_time":{"amount":50,"duration_seconds":300} }

// Drink (auto Hydrated buff) — Glow Cocktail
{ "consumable":true, "restore_thirst":12, "restore_sanity":12,
  "restore_radiation":4, "hydrating":true }

// Accessory — Rad-Counter Wristband
{ "description":"Clicks faster the worse your day is going.", "misc":true, "slot":"accessory" }
```

---

## Quick Checklist for a New Armor Piece

1. Add a `slot` tag — one of the seven canonical slots. (This is what makes it equippable.)
2. Add an `armor` int tag for damage reduction. Without it the piece equips but reduces nothing.
3. Optional `requires` to gate behind a stat; optional `stat_bonus` for passive bumps.
4. Save & Publish in the dev panel — equip it, check `stats` shows the higher Armor number.

---

## Containers

An item with a `container` tag holds other items up to a max total weight (the
tag's integer value). Presence of the tag is what makes it a container — the
value is the capacity, mirroring how `slot` works for equippables.

**Storage.** Contents are tracked relationally on `player_inventory` via a
`container_id` column: a row with `container_id` set lives *inside* the
container whose row id it references. Such rows are excluded from every
"what's here" listing (inventory, ground, `take all`) by an
`AND container_id IS NULL` guard. A contained item keeps its `player_id`; its
location is determined by the container, so picking up or dropping a container
only changes the container row's `player_id` and the contents travel with it.

**Weight.** Carried weight is computed in `computeCarriedWeight()`
(`server/engine/commands/inventory.js`): top-level items at full weight,
contained items at 75%. There is no carry cap — it's surfaced in the
`inventory` listing for information.

**Commands.** `look in <container>` / `examine <container>` list contents and
fill; `stow <item> [in <container>]` (alias `put`) moves an inventory item in
(rejecting nesting and over-capacity); `pull <item> [from <container>]` (also
`take <item> from <container>`) moves it back out. All resolve a container in
the player's inventory or on the ground.

**Two flavors of command — name-resolved vs. by-id.** The text verbs above
(`open`/`stow`/`pull`/`look in`) fuzzy-match a container *by name*. The panel UI
instead drives a parallel set of *by-id* verbs that take a `player_inventory`
row id: `opencontainer <id>`, `closecontainer <id>`, `stowid <invId> <ctrId>`,
`pullid <id>`. These ids are **TEXT UUIDs** — pass them straight to the query,
never `parseInt()` them (see *Lessons Learned* in `architecture.md`).

**Capacity is weight, in grams.** The `container` tag value is a max *weight*, not a
slot count. The panel shows `usedWeight / capacity` (formatted `g`/`kg`) and lists each item's
own weight. Furniture containers default to 60000 (60kg) when unset. When a multi-quantity stackable would overflow, `stowid` does a
**partial fill** — it stows `floor((cap - used) / itemWeight)` of them and leaves
the rest in inventory, surfacing a `notify` line ("Stowed 7x … — bag is now
full.") rather than rejecting the whole stack.

**Where messages go.** Container actions distinguish three audiences:
- **The panel** (in-panel `notify` line, never the main feed): capacity/full
  errors and partial-fill notices. These return `{ type: 'container_error' }`
  or set `notify` on the `container_view`, and the client renders them in the
  `#container-notify` strip so management feedback stays with the management UI.
- **The actor's main feed** (`mainMsg` on the `container_view`, or a plain
  `action`/message result): "You open/close/rummage through a …". Refresh-only
  rebuilds of the view (the silent `opencontainer <id>` after a stow) carry no
  `mainMsg`, so the feed isn't spammed on every shuffle.
- **The zone** (`broadcast(... type:'zone_event' ...)`, excluding the actor):
  others see "Bob opens/closes/rummages through a …". The *contents* are never
  broadcast — only that someone rummaged. To avoid spam, the per-stow/pull
  "rummages through" line (both the broadcast and the actor's `mainMsg`) is
  **throttled to once per 30s per player**; open and close always fire.

**Articles.** Container messages prepend "a"/"an" via a *case-preserving*
`withArticle()` local to `commands/inventory.js` ("a Trash Bag"). This is
deliberately distinct from the `withArticle()` in `commands/world.js`, which
*lowercases* ("a trash bag") for appearance descriptions. Two helpers, two
casing conventions — don't assume they're interchangeable.

## Drugs

A `drug`-tagged item is only half the definition. The mechanical half lives in
the `drugs` table (dev panel → **💊 Drugs**), linked by `item_id`:
`duration_seconds`, `effects`, `addiction_chance`, `overdose_threshold`,
`withdrawal_effects`. `doses_in_system` decays over time; state is tracked per
player in `player_drug_state`. Seeded examples: Buzz, Slow, Glasshollow.
