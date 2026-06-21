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
| `weight` | REAL | Carry weight. Currently informational. |
| `value` | INTEGER | Base price; vendors mark up/down from this. |
| `rarity` | TEXT | `common` / `uncommon` / `rare` / `very_rare`. Flavor + loot tuning. |
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
`hasFlag`, and a re-export of the catalog).

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
| `stackable` | flag | Merges into one quantity row instead of duplicate rows. |
| `quest_item` | flag | Cannot be dropped or sold. |
| `unique` | flag | Reserved marker; not enforced yet. |
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
`hasFlag(invRow, name)`. The crafting `custom_data.quality` value is unrelated
and left untouched.

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
{ "consumable":true, "stackable":true, "heal_over_time":{"amount":50,"duration_seconds":300} }

// Drink (auto Hydrated buff) — Glow Cocktail
{ "consumable":true, "stackable":true, "restore_thirst":12, "restore_sanity":12,
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

## Drugs

A `drug`-tagged item is only half the definition. The mechanical half lives in
the `drugs` table (dev panel → **💊 Drugs**), linked by `item_id`:
`duration_seconds`, `effects`, `addiction_chance`, `overdose_threshold`,
`withdrawal_effects`. `doses_in_system` decays over time; state is tracked per
player in `player_drug_state`. Seeded examples: Buzz, Slow, Glasshollow.
