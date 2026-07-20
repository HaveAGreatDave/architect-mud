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
>
> **Write-time validation (2026-07).** Item tag writes are validated against the
> catalog: the dev-panel item API rejects uncatalogued keys / wrong value shapes
> (`validateTags` in `server/engine/tags.js`, enforced in `itemTagsFor`), and
> `content:lint` applies the same check to `content/items/*.json`. Add a new tag
> to the catalog **first**, then attach it to items. Drift check:
> `node scripts/report-tag-keys.mjs`.
>
> **Zone scope (2026-07).** `zones.flags` is now a catalog-validated tag bag too:
> catalog entries with `scope: 'zone'` (radiation, sanctuary, danger, is_interior,
> building metadata, …) drive the Zone Tags editor in the dev panel, and
> `apiCreateZone`/`apiUpdateZone`/`PATCH /zones/:id/tag` + `content:lint` enforce
> `validateTags` on the bag. Read helpers: `engine/zone-tags.js`
> (`getZoneRadiation`/`isSanctuary`) and `engine/danger.js` (`zoneDanger` —
> inferred, see systems-world.md). The legacy zone columns (danger_rating,
> pvp_enabled, radiation_level, is_safe_zone) were migrated into flags and
> dropped. The `flags` bags on npcs/furniture remain documented-not-validated in
> [flags-keys.md](flags-keys.md), swept by `scripts/report-flag-keys.mjs`.

## Context

The item system's behavior is currently spread across 11 columns on the `items` table: three booleans (`is_stackable`, `is_unique`, `is_quest_item`), the `type`/`subtype` routing fields, and four JSONB blobs (`effects`, `stat_modifiers`, `requirements`, `flags`). The engine reads these through scattered `WHERE` clauses and ad-hoc JS branching, and `docs/items.md` exists largely to document which keys actually do something (e.g. the infamous "armor must go in `effects.armor`, not `stat_modifiers`" trap). As systems grow this gets harder to reason about and easier to author wrong.

**Goal:** collapse all item *behavior* into a single, self-describing `tags` system. A tag has a name and an optional secondary attribute. The engine reads behavior from tags; a shared catalog documents what every tag does so functionality isn't forgotten as the list grows. Class tags (on the item template) cover all current behavior; instance flags (presence-only, on a carried item) enable per-item state like `broken`.

**Decisions locked with the user:**
- **Full unification** — tags become the single source of truth for behavior. The 3 booleans, the behavioral parts of `type`/`subtype`, and all 4 JSONB fields migrate into one `tags` JSONB column.
- Identity/economy scalar columns stay as columns: `id`, `name`, `value`, `weight`.
- `description` becomes a **literal `description` tag** (free text), always present in the editor.
- **Instance tags are presence-only flags** (e.g. `broken`, `cursed`) stored in `player_inventory.custom_data`, no secondary value. Class tags carry the valued attributes.

## Tag Model

Class tags are a JSON object keyed by tag name → secondary attribute; `true` for valueless tags. Example (Pipe Wrench):

```json
{ "description":"Heavy. Reliable. Pre-used.", "weapon":true, "weapon_skill":"clubs",
  "slot":"weapon_hand", "damage":{"min":4,"max":9},
  "requires":{"stat_brawn":6}, "stat_bonus":{"stat_brawn":3} }
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
| `weapon_skill` | enum (`fists`/`blades`/`clubs`/`firearms`/`science`) | `subtype` → combat skill routing |
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
| `fillable` | int (capacity, fluid units) | new — fluid container. Instance `custom_data.fluid_amount`/`fluid_type` hold contents (absent/0 = empty); filling makes a unit unique. Verbs `fill`/`drink`/`empty` live in the **fillable** plugin (thirst-per-unit is a fluid property, not the container's) |

## Gate capabilities on tags, not item ids

The whole point of the tag system is that the engine and plugins reason about **what an item does**, never
**which exact item it is**. A capability gate — any "you need a ⟨tool⟩ to do X" check — must read a tag, so
that *any* item a designer tags that way satisfies it. **A plugin (or engine command) must never hardcode a
specific item id to answer "can the player do X?"** Doing so couples the mechanic to one database row: the
day someone authors a second item that should also work, it silently won't, with no error to explain why.

The distinction:

- **Capability / role gate → tag.** "Do you have a hacking device / a cutting tool / a welder?" Read a tag
  (`hasTag`, or a `player_inventory ⋈ items` join filtered with `jsonb_exists(i.tags,'<tag>')`). This is
  the item-side mirror of the furniture rule in [Furniture capability tags vs. `object_type`](#furniture-capability-tags-vs-object_type)
  — capabilities live in tags, gated by verb plugins, never as a magic literal.
- **Concrete-item reference → id is fine.** Granting, spawning, removing, or crafting *one named item* by
  identity (starter gear, a specific quest object, a recipe's exact output). Here the id **is** the thing.

Litmus test: *if a designer made a second item that should also work here, would they expect tagging it to
be enough?* Yes → use a tag; a hardcoded id is a bug. No (you mean that exact row) → an id is correct.

Converged (2026-07): the hack gate now reads the `hack_device` capability tag, not `item_hack_deck`, in all
three places — `server/engine/commands/doors.js` and `plugins/atm/index.js` (a `player_inventory ⋈ items`
join on `jsonb_exists(i.tags,'hack_device')`) and `plugins/jail/index.js` (`'hack_device' in tags` for
contraband). Any item tagged `hack_device` now works; the blessed deck was tagged in content. The reusable
sweep for this whole bug class is [capability-tag-vs-itemid-audit.md](audits/capability-tag-vs-itemid-audit.md).

The `contraband` tag (Systems group) already gated govgate checkpoint scanning; `plugins/jail/index.js`
`isContraband` was extended (2026-07) to honour it too, so a `contraband`-tagged item is now confiscated on
a search (→ evidence locker) and concealable with `conceal`, exactly like a weapon/drug/hack-deck. Steady
Work's sketchy/hot courier parcels (`item_parcel_sketchy`/`item_parcel_hot`) carry it so the whole crime
stack handles a search with zero new wiring. See the steady-work proposal.

The `fishing_rod` and `bait` tags (Gear group) follow the same pattern: `plugins/fishing/index.js` gates
`fish` on carrying any uncontained item tagged `fishing_rod` (`jsonb_exists(i.tags,'fishing_rod')`), and
treats any `bait`-tagged item as optional bait (a sub-tag like `bait_bloodworm` gates specific catches).
Pair `fishing_rod` with `unique` so each rod keeps its own condition — a botched reel can snap it. See
[systems-fishing.md](systems-fishing.md).

## Supertags (tags-of-tags)

> **Status (as built, 2026-07).** Dev-panel-only template, no engine-side link.

A **supertag** is a named bundle of catalog tags — a reusable "class" of item. The
`weapon_clubs` supertag, for instance, carries `{ weapon:true, slot:"weapon_hand", weapon_skill:"clubs", … }`
so every club starts from the same wiring (the five `weapon_*` supertags — one per
combat skill — are the seeded set). Supertags are edited in the dev panel's
**Tags** screen (Supertags section) and live in `client/shared/tagSupertags.js`
(`globalThis.TAG_SUPERTAGS`), a dual-mode file mirroring `tagCatalog.js`. Routes
`GET`/`PUT /tag-supertags` read/write it.

**One-time template, not a live link.** Applying a supertag to an item in the dev-panel
item editor copies its member tags into the item's own editable tag fields immediately,
pre-filled with the supertag's defaults (e.g. `damage`), so the user can tweak sub-values
before saving. From that point the fields are just ordinary item tags — there is **no
ongoing reference** to the supertag. Editing or deleting a supertag definition later only
changes what future applications pre-fill; it never touches items already stamped with it.
This keeps supertags purely a dev-panel authoring convenience — the engine's reads
(`tagsOf()`, SQL gates like `jsonb_exists(i.tags,'weapon')`) see a plain flat `tags` object,
with no special casing.

Items saved under an earlier version of this feature may still carry `__super`/`__own`
bookkeeping keys in their stored `tags` from a since-removed live-materialization model.
`ownTags()` (`server/engine/supertags.js`) strips these on read/write so they never surface
as phantom tags; `tagsOf()` does the same for the same reason. No new item write path
produces these keys.

## Approach

### Shared catalog — single source of truth
New file `client/shared/tagCatalog.js` (served at `/shared/*`). Exports `TAG_CATALOG`, a map of tag name → `{ label, shape, scope:'class'|'instance'|'furniture', group, help, options?, targets? }`, plus helpers `tagTargets(def)` / `tagAppliesTo(def, surface)`. `scope` is engine storage semantics (item template vs `custom_data` vs `furniture.flags`). The optional `targets` array (`['item','furniture']`) controls which dev-panel editors offer the tag and is set via the **Usable on** checkboxes on the Tags screen — a tag can be attachable on both (e.g. `broadcast_receiver`). When `targets` is absent, applicability is derived from `scope` (class→item, furniture→furniture, instance→neither). Furniture **capability tags** (e.g. `water_source`) are stored as flat keys in `furniture.flags`, surfaced via `tagsOf()`, and gated on by verb plugins. Both the item and furniture editors render the same dropdown-picker + chips UI (`tagAppliesTo(def,'item'|'furniture')` filters the list); the furniture picker stores values as flat keys in `flags`. Written to work **both** as a browser global (`window.TAG_CATALOG`) and ESM (`export`), because the dev-panel `<script>` is a classic script (not a module) and the Node engine uses `import`. `shape` is one of `text|flag|int|enum|range|hot|statmap` and drives both the dev-panel input widget and serialization.

New helper `server/engine/tags.js` imports the catalog (relative import from `client/shared/`) and exposes `hasTag(item,name)`, `tagValue(item,name,default)`, `hasFlag(invRow,name)`, and re-exports `TAG_CATALOG`.

#### Furniture capability tags vs. `object_type`

`furniture.object_type` is a single-valued **structural class** (`light`, `container`, `furniture`) with dedicated columns and subsystems behind it — keep reading those by `object_type`. **Capabilities** ("what can you do here") belong in `furniture.flags` as catalog tags, gated by verb plugins — never as magic `object_type` strings the editor dropdown can't even produce. Migrated capabilities: `toilet`, `cosmetic_machine` (new furniture tags), and `sink` → the existing `water_source` capability. The engine reads each with a transition `OR` (`WHERE object_type='toilet' OR jsonb_exists(flags,'toilet')`) so legacy rows keep working with no data change; run `scripts/migrate-furniture-capability-tags.js` once to backfill the flags, after which the `object_type` half of each read can be dropped. `media_deck` is a flag tag already; the broadcast panel sets `flags.media_deck` on every deck, so the look-render reads the flag too. The three broadcast device tags (`broadcast_receiver`/`broadcast_transmitter`/`broadcast_device_type`) carry `targets:['item','furniture']` so the furniture editor offers them — the engine has always read them off furniture `flags`.

### Engine cutover (read behavior from `tags`)
Replace column reads with tag reads across the behavior touchpoints. Pattern: SELECT `i.tags` instead of the legacy columns; branch in JS, or gate in SQL with `jsonb_exists(i.tags,'<name>')` / `i.tags ->> '<key>'` (avoid the bare `?` operator — it collides with node-pg placeholders). Representative changes:
- `server/engine/commands/inventory.js` — `recomputeArmor` sums `tags.armor`; `cmdInventory` reads instance flags; `cmdTake`/`cmdDrop` stack via `isStackable()` (default unless `tags.unique`) / `NOT jsonb_exists(i.tags,'quest_item')`; `cmdUse` gates on `jsonb_exists(i.tags,'consumable')` and reads `restore_*`/`heal_over_time`/`well_fed`/`hydrating`; `cmdEquip*` gate on `jsonb_exists(i.tags,'slot')`, read `tags.requires` and `tags.slot`.
- `plugins/weapon/index.js` (formerly `server/engine/commands/combat.js`) — weapon lookup gates on `jsonb_exists(i.tags,'weapon')`; reads `tags.damage` and `tags.weapon_skill`. (`rollAttack` in `server/engine/combat.js` is field-agnostic — unchanged.)
- `server/engine/vendor.js` — sell quest-block via `tags.quest_item`; buy stack via `isStackable()` (default unless `tags.unique`).
- `server/engine/crafting.js` — output stacking via `isStackable()` (default unless `tags.unique`); `custom_data` quality match unchanged.

### Dev panel
Rewrite `itemEditForm` and `saveItem` in `client/devpanel/index.html` (~1439–1489); add `<script src="/shared/tagCatalog.js"></script>` before the main script (~line 158). Layout:
- Scalar fields kept: ID, Name, Weight, Value.
- **Always-present `description` textarea**, rendered first, never removable.
- **Active-tags list**: one row per tag in `rec.tags`, input widget chosen by catalog `shape` (flag→chip, int→number, enum→select, range→two inputs, hot→amount+duration, statmap/text→small JSON textarea). Each row shows the catalog `help` text inline (reuse `.zone-subsection-note`) and a remove (×) button.
- **Add-tag picker**: `<select>` built from `TAG_CATALOG` grouped by `group`, filtered to `scope==='class'`, excluding already-present tags + `description`, with an Add button.
- `saveItem` assembles `tags` from the rows (coercing by shape, JSON.parse with the existing try/catch→`{error}` pattern) and posts `{name, weight, value, tags}`. Saving still flows through the unchanged `API()` staging interceptor — `getEntityType('/items')` already returns `items`.

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
- `plugins/weapon/index.js` (weapon lookup), `server/engine/vendor.js`, `server/engine/crafting.js`
- `server/api/routes.js` — `apiCreateItem`/`apiUpdateItem`
- `client/devpanel/index.html` — `itemEditForm`/`saveItem`
- `docs/items.md` — rewrite for the tag model

## Verification
No automated test harness exists — verify manually in-game and via dev-panel round-trips, plus read-only SQL spot-checks.
- In-game: equip Pipe Wrench (str gate + slot), attack (damage range + clubs XP), eat a ration (hunger + well-fed buff), drink water (hydrated buff), use a bandage (heal-over-time ticks), drop a quest item (blocked), sell a quest item (blocked), take a stackable item + craft stacking, check `stats` Armor after equipping Scrap Vest.
- Dev panel: edit an item — add/remove tags of each shape, save through staging, confirm round-trip; create a new item; export/restore a `.sql` dump and spot-check `tags` survives.
