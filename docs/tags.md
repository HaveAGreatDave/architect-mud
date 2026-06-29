# Item Tags System

> **Status (as built, 2026-06).** The tag system shipped and now extends to every
> Entity (see [ADR-0003](adr/0003-tag-mechanism-unification.md)). This doc is the
> standing reference for the tag model; the sections below are the original design
> plan, corrected where the build diverged. Two such divergences:
>
> - **No migrations, ever.** The `server/models/migrate.js` backfill described
>   here was removed; per [CLAUDE.md](../CLAUDE.md) schema lives in
>   `server/models/schema.js` (`SCHEMA_SQL`) and content is restored from dev-panel
>   `.sql` dumps. There is no checked-in `seed.js` and nothing rewrites content on
>   boot. Treat the "Migration"/"seed" subsections below as historical.
> - **Legacy columns were never dropped.** Phase 5 didn't happen: `is_stackable`,
>   `is_unique`, `is_quest_item`, etc. still exist in `schema.js` alongside the
>   `tags` column. The engine reads behavior *only* from `tags` via
>   `server/engine/tags.js`, but the old columns remain inert in the schema.
>
> The catalog (`client/shared/tagCatalog.js`), helpers (`server/engine/tags.js`),
> and the Tag→Action registry (`server/engine/specializedActions.js`) are all live
> and are the parts to build on.

## Context

The item system's behavior is currently spread across 11 columns on the `items` table: three booleans (`is_stackable`, `is_unique`, `is_quest_item`), the `type`/`subtype` routing fields, and four JSONB blobs (`effects`, `stat_modifiers`, `requirements`, `flags`). The engine reads these through scattered `WHERE` clauses and ad-hoc JS branching, and `docs/items.md` exists largely to document which keys actually do something (e.g. the infamous "armor must go in `effects.armor`, not `stat_modifiers`" trap). As systems grow this gets harder to reason about and easier to author wrong.

**Goal:** collapse all item *behavior* into a single, self-describing `tags` system. A tag has a name and an optional secondary attribute. The engine reads behavior from tags; a shared catalog documents what every tag does so functionality isn't forgotten as the list grows. Class tags (on the item template) cover all current behavior; instance flags (presence-only, on a carried item) enable per-item state like `broken`.

**Decisions locked with the user:**
- **Full unification** — tags become the single source of truth for behavior. The 3 booleans, the behavioral parts of `type`/`subtype`, and all 4 JSONB fields migrate into one `tags` JSONB column.
- Identity/economy scalar columns stay as columns: `id`, `name`, `value`, `weight`, `rarity`.
- `description` becomes a **literal `description` tag** (free text), always present in the editor.
- **Instance tags are presence-only flags** (e.g. `broken`, `cursed`) stored in `player_inventory.custom_data`, no secondary value. Class tags carry the valued attributes. (The existing `custom_data.quality` from crafting is the one valued exception and is left untouched.)

## Tag Model

Class tags are a JSON object keyed by tag name → secondary attribute; `true` for valueless tags. Example (Pipe Wrench):

```json
{ "description":"Heavy. Reliable. Pre-used.", "weapon":true, "weapon_skill":"blunt",
  "slot":"weapon_hand", "damage":{"min":4,"max":9},
  "requires":{"stat_str":6}, "stat_bonus":{"stat_str":3} }
```

**Name-collision resolution:** equip-eligibility is signaled by the presence of a `slot` tag (not a separate `armor`/`weapon` marker for that purpose); `armor` is purely the integer damage-reduction tag. `weapon` remains a marker tag (combat reads it to find the equipped weapon).

### Taxonomy (covers all current functionality)

| Tag | Shape | Replaces |
|---|---|---|
| `description` | string | `description` column |
| `weapon` | `true` | `type='weapon'` (combat weapon lookup) |
| `consumable` | `true` | `type='consumable'` (use gate) |
| `material`/`currency`/`misc` | `true` | `type` markers (filtering/flavor) |
| `drug` | `true` | `type='drug'` (visibility; routing still via `drugs` join) |
| `quest_item` | `true` | `is_quest_item` |
| `unique` | `true` | `is_unique`; prevents stacking (items stack by default) |
| `slot` | enum (`head`/`torso`/`hands`/`legs`/`feet`/`weapon_hand`/`accessory`) | `flags.slot` (+ weapon fallback made explicit); presence = equippable |
| `damage` | `{min,max}` | `effects.damage_min/max` |
| `weapon_skill` | enum (`blunt`/`bladed`/`energy`) | `subtype` → combat skill routing |
| `armor` | int | `effects.armor` |
| `status_chance` | `{status:float}` | `effects.status_chance` |
| `restore_hp`/`restore_hunger`/`restore_thirst`/`restore_radiation`/`restore_sanity` | int | `effects.hp`/`hunger`/`thirst`/`radiation`/`sanity` |
| `grants_credits` | int | `effects.credits` |
| `heal_over_time` | `{amount,duration_seconds}` | `effects.hp_over_time` |
| `well_fed` | `true` | `subtype='food'` buff |
| `hydrating` | `true` | `subtype='drink'` buff |
| `requires` | `{stat_*:int}` | `requirements` |
| `stat_bonus` | `{stat_*:int}` | `stat_modifiers` |
| `broken`/`cursed` (instance) | `true` | new presence flags in `custom_data` |

## Supertags (tags-of-tags)

> **Status (as built, 2026-06).** Added after the original tag system shipped.

A **supertag** is a named bundle of catalog tags — a reusable "class" of item. A
`weapon` supertag might carry `{ weapon:true, slot:"weapon_hand", weapon_skill:"blunt" }`
so every weapon is configured the same way. Supertags are edited in the dev panel's
**Tags** screen (Supertags section) and live in `client/shared/tagSupertags.js`
(`globalThis.TAG_SUPERTAGS`), a dual-mode file mirroring `tagCatalog.js`. Routes
`GET`/`PUT /tag-supertags` read/write it.

**Live reference, materialized for SQL.** Applying a supertag to an item flattens
its member tags onto the item's stored `tags` object, so the engine's existing reads
— both `tagsOf()` and SQL gates like `jsonb_exists(i.tags,'weapon')` — work with **no
special casing**. Provenance is recorded in two bookkeeping keys so the link stays live:

- `__super` — array of applied supertag keys
- `__own` — the item's own authored tags (always win over supertag-supplied members)

Editing a supertag (`PUT /tag-supertags`) re-materializes every item whose `tags`
contains `__super` (`materializeItemTags` in `server/engine/supertags.js`): each item is
re-derived from `__own` + the current supertag members, so removed members drop and
added members appear. Items with no supertags store flat tags with no bookkeeping keys —
identical to the pre-supertag format, so nothing migrates. `tagsOf()` strips `__super`/
`__own` so they never surface as phantom tags.

Item writes (`apiCreateItem`/`apiUpdateItem`) take authored tags in `body.tags` and
applied supertag keys in `body.supertags`, and call `materializeItemTags` to build the
stored object. The dev-panel item editor edits only `__own` (the tag rows) and shows
applied supertags as inherited chips.

## Approach

### Shared catalog — single source of truth
New file `client/shared/tagCatalog.js` (served at `/shared/*`). Exports `TAG_CATALOG`, a map of tag name → `{ label, shape, scope:'class'|'instance'|'furniture', group, help, options?, targets? }`, plus helpers `tagTargets(def)` / `tagAppliesTo(def, surface)`. `scope` is engine storage semantics (item template vs `custom_data` vs `furniture.flags`). The optional `targets` array (`['item','furniture']`) controls which dev-panel editors offer the tag and is set via the **Usable on** checkboxes on the Tags screen — a tag can be attachable on both (e.g. `broadcast_receiver`). When `targets` is absent, applicability is derived from `scope` (class→item, furniture→furniture, instance→neither). Furniture **capability tags** (e.g. `water_source`) are stored as flat keys in `furniture.flags`, surfaced via `tagsOf()`, and gated on by verb plugins. Both the item and furniture editors render the same dropdown-picker + chips UI (`tagAppliesTo(def,'item'|'furniture')` filters the list); the furniture picker stores values as flat keys in `flags`. Written to work **both** as a browser global (`window.TAG_CATALOG`) and ESM (`export`), because the dev-panel `<script>` is a classic script (not a module) and the Node engine uses `import`. `shape` is one of `text|flag|int|enum|range|hot|statmap` and drives both the dev-panel input widget and serialization.

New helper `server/engine/tags.js` imports the catalog (relative import from `client/shared/`) and exposes `hasTag(item,name)`, `tagValue(item,name,default)`, `hasFlag(invRow,name)`, and re-exports `TAG_CATALOG`.

### Engine cutover (read behavior from `tags`)
Replace column reads with tag reads across the behavior touchpoints. Pattern: SELECT `i.tags` instead of the legacy columns; branch in JS, or gate in SQL with `jsonb_exists(i.tags,'<name>')` / `i.tags ->> '<key>'` (avoid the bare `?` operator — it collides with node-pg placeholders). Representative changes:
- `server/engine/commands/inventory.js` — `recomputeArmor` sums `tags.armor`; `cmdInventory` reads instance flags; `cmdTake`/`cmdDrop` stack via `isStackable()` (default unless `tags.unique`) / `NOT jsonb_exists(i.tags,'quest_item')`; `cmdUse` gates on `jsonb_exists(i.tags,'consumable')` and reads `restore_*`/`heal_over_time`/`well_fed`/`hydrating`; `cmdEquip*` gate on `jsonb_exists(i.tags,'slot')`, read `tags.requires` and `tags.slot`.
- `server/engine/commands/combat.js` — weapon lookup gates on `jsonb_exists(i.tags,'weapon')`; reads `tags.damage` and `tags.weapon_skill`. (`rollAttack` in `server/engine/combat.js` is field-agnostic — unchanged.)
- `server/engine/vendor.js` — sell quest-block via `tags.quest_item`; buy stack via `isStackable()` (default unless `tags.unique`).
- `server/engine/crafting.js` — output stacking via `isStackable()` (default unless `tags.unique`); `custom_data` quality match unchanged.

### Dev panel
Rewrite `itemEditForm` and `saveItem` in `client/devpanel/index.html` (~1439–1489); add `<script src="/shared/tagCatalog.js"></script>` before the main script (~line 158). Layout:
- Scalar fields kept: ID, Name, Rarity, Weight, Value.
- **Always-present `description` textarea**, rendered first, never removable.
- **Active-tags list**: one row per tag in `rec.tags`, input widget chosen by catalog `shape` (flag→chip, int→number, enum→select, range→two inputs, hot→amount+duration, statmap/text→small JSON textarea). Each row shows the catalog `help` text inline (reuse `.zone-subsection-note`) and a remove (×) button.
- **Add-tag picker**: `<select>` built from `TAG_CATALOG` grouped by `group`, filtered to `scope==='class'`, excluding already-present tags + `description`, with an Add button.
- `saveItem` assembles `tags` from the rows (coercing by shape, JSON.parse with the existing try/catch→`{error}` pattern) and posts `{name, rarity, weight, value, tags}`. Saving still flows through the unchanged `API()` staging interceptor — `getEntityType('/items')` already returns `items`.

Reuses existing `.field`, `.field-row`, `.checkbox-field`, `.zone-subsection-note` styles — no new CSS framework. The catalog's `help` text is the in-panel "what does this tag do" reference the user asked for.

### API
- `server/api/routes.js`: `apiCreateItem`/`apiUpdateItem` write the `tags` JSONB. (The item INSERT still names the legacy columns — see `routes.js:1328` — because they remain in the schema; behavior never reads them.)

> _Historical — superseded by the no-migrations rule._ Item rows for a fresh DB
> are no longer seeded from a checked-in `seed.js`; a fresh database is populated
> by restoring a dev-panel `.sql` dump (schema + content), and `tags` rides along
> in that dump.

### Schema (historical — was a one-shot migration, now lives in `schema.js`)
The `tags JSONB DEFAULT '{}'` column on `items` is declared in `server/models/schema.js`
(`SCHEMA_SQL`) and applied with `npm run db:schema`. The original plan's idempotent
JS backfill (building `tags` from `description`/`type`/`subtype`/booleans/`effects`/`flags`/
`requirements`/`stat_modifiers`) ran once during the cutover and is gone. **The legacy
behavioral columns were never dropped** — they sit inert in `schema.js` next to `tags`.

No schema change for instance flags — `custom_data` is already JSONB; `broken`/`cursed` are written as `custom_data.<flag>=true` by future game logic and read via `hasFlag()`.

## Implementation Order (as executed — steps 1–4 and 6 shipped; step 5 was skipped)
1. **Catalog & helper** — `client/shared/tagCatalog.js`, `server/engine/tags.js`. No behavior change. ✅
2. **Schema** — `tags` column declared in `schema.js`; cutover backfill ran once and was removed. ✅
3. **Engine cutover** — inventory.js, combat.js, vendor.js, crafting.js read from `tags`. ✅ Later extended to every Entity (ADR-0003) via `tagsOf()` reading `tags` **or** the legacy `flags` bag.
4. **API + dev panel** — routes write `tags`, editor built from the catalog. ✅
5. **Drop legacy columns** — _not done._ The behavioral columns remain in `schema.js`, inert.
6. **Docs** — `docs/items.md` describes the tag model + catalog as the source of truth. ✅

## Critical Files
- `client/shared/tagCatalog.js` *(new — shared single source of truth)*
- `server/engine/tags.js` *(engine helpers — `hasTag`/`tagValue`/`hasFlag`/`tagsOf`)*
- `server/engine/specializedActions.js` *(Tag→Action registry — the extensibility seam, ADR-0003)*
- `server/models/schema.js` — declares the `tags` column (and the still-present legacy columns)
- `server/engine/commands/inventory.js` — most behavior touchpoints
- `server/engine/commands/combat.js`, `server/engine/vendor.js`, `server/engine/crafting.js`
- `server/api/routes.js` — `apiCreateItem`/`apiUpdateItem`
- `client/devpanel/index.html` — `itemEditForm`/`saveItem`
- `docs/items.md` — rewrite for the tag model

## Verification
No automated test harness exists — verify manually in-game and via dev-panel round-trips, plus read-only SQL spot-checks.
- In-game: equip Pipe Wrench (str gate + slot), attack (damage range + blunt XP), eat a ration (hunger + well-fed buff), drink water (hydrated buff), use a bandage (heal-over-time ticks), drop a quest item (blocked), sell a quest item (blocked), take a stackable item + craft stacking, check `stats` Armor after equipping Scrap Vest.
- Dev panel: edit an item — add/remove tags of each shape, save through staging, confirm round-trip; create a new item; export/restore a `.sql` dump and spot-check `tags` survives.
