# Item Properties Reference

How items are defined, what every field does, and — importantly — **which JSON
keys the engine actually reads**. Several fields look like they should work and
don't, because the engine only honors specific keys. This doc is the source of
truth for that, vetted against the engine code (`server/engine/commands.js`,
`server/engine/combat.js`) and the canonical seed (`server/models/seed.js`).

Items are content, not code: they live in the `items` table and are edited
through the dev panel's **🗡 Items** editor. Nothing here requires a deploy.

---

## The `items` Table

Every item is one row. Columns (see `server/models/migrate.js`):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | e.g. `item_scrap_armor` |
| `name` | TEXT | Display name. Commands fuzzy-match on this (`ILIKE %name%`). |
| `description` | TEXT | Shown on `examine`/`look <item>`. |
| `type` | TEXT | Drives behavior — see [Types](#item-types) below. |
| `subtype` | TEXT | Flavor + a few real hooks (`food`/`drink` buffs, slot fallbacks). |
| `weight` | REAL | Carry weight. Currently informational — no enforced carry cap yet. |
| `value` | INTEGER | Base price; vendors mark up/down from this. |
| `rarity` | TEXT | `common` / `uncommon` / `rare` / `very_rare`. Flavor + loot tuning. |
| `is_stackable` | INTEGER | `1` = merges into a single quantity row instead of duplicate rows. |
| `is_unique` | INTEGER | Reserved; not enforced in engine logic yet. |
| `is_quest_item` | INTEGER | `1` = cannot be dropped (`cmdDrop` filters `is_quest_item=0`). |
| `effects` | JSONB | **The workhorse.** What the item *does*. See below. |
| `stat_modifiers` | JSONB | Passive stat bumps. See the armor warning below. |
| `requirements` | JSONB | Gates equipping — `{ "stat_str": 6 }` style. |
| `flags` | JSONB | Misc, including the all-important `slot`. |

Booleans are stored as `0/1` INTEGER, not `true/false` — a raw boolean sent to
these columns crashes `pg`. The dev panel coerces this for you; only matters if
you write SQL by hand.

---

## ⚠️ Armor: the format that actually works

This is the single most common item-authoring mistake, so it gets top billing.

**Armor reduction is read from `effects.armor`, NOT `stat_modifiers.armor`.**

Combat subtracts `defender.armor` from incoming damage
(`server/engine/combat.js` → `rollAttack`). For a player, `player.armor` is a
derived value, recomputed on login and after every equip change by
`recomputeArmor()` in `commands.js`:

```js
// commands.js
player.armor = rows.reduce((sum, r) => sum + (r.effects?.armor || 0), 0);
```

It sums `effects.armor` across every **equipped** item. So an armor piece must
look like this:

```jsonc
// item: Scrap Vest — CORRECT
{
  "type": "armor",
  "subtype": "chest",
  "effects":        { "armor": 3 },     // ← engine reads THIS
  "stat_modifiers": {},
  "flags":          { "slot": "torso" } // ← must be a valid slot (see below)
}
```

A piece written the old way is silently worthless — it equips, occupies the
slot, but contributes **0** damage reduction:

```jsonc
// WRONG — armor in stat_modifiers is ignored by combat
{ "effects": {}, "stat_modifiers": { "armor": 2 }, "flags": { "slot": "chest" } }
```

Two traps in that wrong example:
1. `stat_modifiers.armor` is never read for damage reduction.
2. `slot: "chest"` is not a real slot — the valid torso slot is `"torso"`.
   An invalid slot falls back to a generic type-named slot for weapons, but
   armor with no valid slot refuses to equip at all.

A one-time migration in `migrate.js` rewrites a legacy **uppercase** `"ARMOR"`
effects key down to lowercase `"armor"`, but it does **not** rescue armor that
was put in `stat_modifiers`. If an old armor item does nothing, check this first.

The dev panel's Item editor labels the effects field accordingly:
*"armor items use `{"armor": N}` for damage reduction."* Follow that.

---

## The `effects` JSON — every key the engine honors

`effects` is consulted by `cmdUse` (consumables/drugs), `recomputeArmor`
(equipment), and `rollAttack` (weapons). Keys the engine actually reads:

### Equipment effects
| Key | Used by | Meaning |
|---|---|---|
| `armor` | combat (via `recomputeArmor`) | Flat damage reduction while equipped. Stacks across all worn pieces. |
| `damage_min` / `damage_max` | combat (weapons) | Weapon damage roll range. Read off the equipped weapon when you attack. |
| `status_chance` | combat (weapons) | e.g. `{ "stunned": 0.3 }` — chance to inflict a status on hit. |

### Consumable effects (`cmdUse`)
| Key | Meaning |
|---|---|
| `hp` | Instant flat HP change (can be negative — Rust Whiskey does `hp: -2`). |
| `hunger` | Restores the hunger meter (capped at 100). |
| `thirst` | Restores the thirst meter (capped at 100). |
| `radiation` | Adds/removes radiation (RadAway™ uses `-20`). |
| `sanity` | Adjusts Sanity (drinks restore it; Glasshollow drops it). |
| `credits` | Currency pickups (`item_credits_small` = `{ "credits": 10 }`). |
| `hp_over_time` | `{ "amount": N, "duration_seconds": S }` — gradual heal, ticks once/min, **stacks** if re-used. Field Bandage & Trauma Kit use this. |
| `status_chance` | On consumables too — Raw Meat: `{ "food_poisoning": 0.6 }`. |

A consumable can carry several of these at once; `cmdUse` applies each present
key. The item is consumed (quantity-1 or row deleted) and grants 1 Medicine XP.

### Buffs are driven by `subtype`, not `effects`
`cmdUse` grants timed buffs based on **`subtype`**, automatically, on top of
whatever `effects` do:
- `subtype: "food"` → **Well-Fed** (faster HP regen), 10 minutes.
- `subtype: "drink"` → **Hydrated** (faster radiation decay), 10 minutes.

So any new food/drink gets the right buff for free — just set the subtype.

---

## `stat_modifiers` JSON

Passive stat bumps carried by an item, e.g. the Pipe Wrench's `{"stat_str": 3}`
or the Taser's `{"stat_agi": 4}`. Use real stat column names: `stat_str`,
`stat_agi`, `stat_int`, `stat_wil`, `stat_end`, `stat_cha`.

**Do not put `armor` here** — see the warning above. Armor goes in `effects`.

---

## `requirements` JSON

Checked by `cmdEquip`/`cmdEquipById` before allowing an equip. Each key is a
player field that must meet or exceed the value:

```jsonc
{ "stat_str": 6 }   // "Need str 6 to use this." if the player is under
```

---

## `flags` JSON

Freeform, but two keys are meaningful to the engine:

| Flag | Meaning |
|---|---|
| `slot` | Which body slot this equips to. **Must** be one of the seven canonical slots below for armor; weapons without a slot default to `weapon_hand`. |
| (others) | Anything else is content/flavor — the engine ignores unknown flags. |

### Canonical equip slots
From `EQUIP_SLOTS` in `commands.js` — these strings, exactly:

```
head · torso · hands · legs · feet · weapon_hand · accessory
```

Equipping one item into an occupied slot auto-unequips whatever was there. The
visual inventory panel (`inv`) maps drag targets to these same slots.

---

## Item Types

`type` is the primary behavior switch.

| Type | Behavior |
|---|---|
| `weapon` | Equippable into `weapon_hand` (or `flags.slot`). Uses `effects.damage_min/max`. |
| `armor` | Equippable into `flags.slot`. Uses `effects.armor`. |
| `consumable` | Usable via `use`/`eat`/`drink`. Runs the `effects` consumable keys + subtype buffs. |
| `drug` | Usable via `use`, but routed through the **drug engine** (addiction/overdose/duration), not the plain consumable path. Needs a matching row in the `drugs` table joined by `item_id`. |
| `material` | Crafting input. No direct use. |
| `currency` | Credit chips — `effects.credits` is granted on use. |
| `misc` | Key items, artifacts, accessories. May still be equippable if it has a valid `flags.slot` (e.g. the Rad-Counter Wristband → `accessory`). |

`equip`/`unequip` only accept `type IN ('weapon','armor')` via typed commands.
A `misc` accessory is equippable through the visual panel's id-targeted path
when it has a valid slot.

---

## Drugs

A `type: "drug"` item is only half the definition. The mechanical half lives in
the `drugs` table (dev panel → **💊 Drugs**), linked by `item_id`:

| Field | Meaning |
|---|---|
| `duration_seconds` | How long the dose stays active. |
| `effects` | Same stat keys as consumables (`hp`, `sanity`, `radiation`, plus `stat_*_temp`). |
| `addiction_chance` | Per-use roll to become addicted. |
| `overdose_threshold` | Doses-in-system at which an overdose triggers. |
| `withdrawal_effects` | `{ "overdose": { "hp": -20, ... } }` — applied on overdose. |

`doses_in_system` decays over time once a dose's `active_until` passes. State is
tracked per player in `player_drug_state`. Seeded examples: Buzz, Slow,
Glasshollow.

---

## Worked Examples (from the live seed)

```jsonc
// Weapon — Pipe Wrench
{ "type":"weapon", "subtype":"blunt",
  "effects":{"damage_min":4,"damage_max":9},
  "stat_modifiers":{"stat_str":3},
  "flags":{"slot":"weapon_hand"} }

// Energy weapon with on-hit status — Custodian Taser
{ "type":"weapon", "subtype":"energy",
  "effects":{"damage_min":5,"damage_max":8,"status_chance":{"stunned":0.3}},
  "stat_modifiers":{"stat_agi":4},
  "flags":{"slot":"weapon_hand"} }

// Armor — Scrap Helmet (head)
{ "type":"armor", "subtype":"head",
  "effects":{"armor":2}, "flags":{"slot":"head"} }

// Gradual heal — Trauma Kit
{ "type":"consumable", "subtype":"medicine",
  "effects":{"hp_over_time":{"amount":50,"duration_seconds":300}} }

// Drink (auto Hydrated buff via subtype) — Glow Cocktail
{ "type":"consumable", "subtype":"drink",
  "effects":{"thirst":12,"sanity":12,"radiation":4} }

// Accessory in misc — Rad-Counter Wristband
{ "type":"misc", "subtype":"accessory",
  "effects":{}, "flags":{"slot":"accessory"} }
```

---

## Quick Checklist for a New Armor Piece

1. `type` = `armor`.
2. Damage reduction goes in **`effects`**: `{ "armor": N }`.
3. `flags.slot` is one of: `head torso hands legs feet weapon_hand accessory`.
4. Leave `stat_modifiers` for stat bumps only (or `{}`).
5. Optional: `requirements` to gate it behind a stat.
6. Save & Publish in the dev panel — equip it, check `stats` shows the higher
   Armor number. If it reads 0, you used `stat_modifiers` or a bad slot.
