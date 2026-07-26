# The Tag System (as built)

Tags are how every Entity in the game declares what it *does*. One catalog
describes every tag; the engine gates behavior on tag names and nothing else.
This doc is the model and the rules — the per-tag reference table lives in
[items.md](items.md), and the machine-readable list is
`client/shared/tagCatalog.js`.

**Where a tag bag lives, by Entity.** Items keep theirs in `items.tags`; zones,
NPCs, furniture and enemies keep the same kind of markers in their `flags` JSONB.
`tagsOf(entity)` reads either, so the tag mechanism and the Tag→Action registry
treat every Entity uniformly ([ADR-0003](adr/0003-tag-mechanism-unification.md)).

**Two bags are catalog-validated on write; two are not.**

- **Items** — `validateTags` ([tags.js:63](../server/engine/tags.js)) rejects
  uncatalogued keys and wrong value shapes, enforced in `itemTagsFor`
  ([routes.js:1811](../server/api/routes.js)); `content:lint` applies the same
  check to `content/items/*.json`.
- **Zones** — `zones.flags` is a tag bag too. Catalog entries with `scope:'zone'`
  (radiation, sanctuary, danger, is_interior, building metadata, …) drive the Zone
  Tags editor, and `apiCreateZone`/`apiUpdateZone`/`PATCH /zones/:id/tag` +
  `content:lint` enforce `validateTags`. Read helpers: `engine/zone-tags.js`
  (`getZoneRadiation`/`isSanctuary`) and `engine/danger.js` (`zoneDanger` —
  inferred, see [systems-world.md](systems-world.md)).
- **NPCs and furniture** — documented-not-validated, in
  [flags-keys.md](flags-keys.md), swept by `scripts/report-flag-keys.mjs`.

**Add a new tag to the catalog first, then attach it.** A key that isn't in the
catalog is silently inert forever — that's the recurring bug class this validation
exists to kill. Drift check: `node scripts/report-tag-keys.mjs`.

## Tag Model

Identity/economy stays scalar columns (`id`, `name`, `value`, `weight`) — only
*behavior* is tags. `description` is a literal `description` tag, always present
in the editor.

Class tags are a JSON object keyed by tag name → secondary attribute; `true` for valueless tags. Example (Pipe Wrench):

```json
{ "description":"Heavy. Reliable. Pre-used.", "weapon":true, "weapon_skill":"clubs",
  "slot":"weapon_hand", "damage":{"min":4,"max":9},
  "requires":{"stat_brawn":6}, "stat_bonus":{"stat_brawn":3} }
```

**Name-collision resolution:** equip-eligibility is signaled by the presence of a `slot` tag — never by `weapon`
or by an armor marker. `weapon` is purely the combat-weapon marker (combat reads it to find the equipped weapon),
and armor protection comes only from the `armor_soak` statmap (the flat integer `armor` tag was removed with the
typed-soak cutover — see [combat.md](combat.md)).

One storage contract that lives in neither the catalog nor
[items.md § Class Tags](items.md#class-tags-taxonomy): `fillable` (int capacity in fluid units) keeps its
contents in instance `custom_data.fluid_amount` / `fluid_type` (absent/0 = empty), and filling makes a unit
unique — thirst-per-unit is a property of the fluid, not the container.

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

The reusable sweep for this whole bug class is
[capability-tag-vs-itemid-audit.md](audits/capability-tag-vs-itemid-audit.md).

Worked example — `hack_device`. Three unrelated call sites gate on the same tag and nothing else:
[doors.js:330](../server/engine/commands/doors.js) and [atm/index.js:18](../plugins/atm/index.js) run a
`player_inventory ⋈ items` join on `jsonb_exists(i.tags,'hack_device')`; [jail/index.js:88](../plugins/jail/index.js)
tests `'hack_device' in tags` for contraband. Tag a new deck in content and all three light up with zero code.
`contraband`, `fishing_rod` and `bait` work the same way. Two gotchas worth knowing: `jail`'s `isContraband`
also honours the plain `contraband` tag (so a courier parcel is confiscated and concealable like a weapon),
and a `fishing_rod` should be paired with `unique` so each rod keeps its own condition — a botched reel can
snap it ([systems-fishing.md](systems-fishing.md)).

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

## Shared catalog — single source of truth

`client/shared/tagCatalog.js` (served at `/shared/*`) exports `TAG_CATALOG`, a map of tag name → `{ label, shape, scope, group, help, options?, targets? }`. `scope` is engine storage semantics: `class` (item template `tags`), `instance` (`player_inventory.custom_data`), `furniture` (`furniture.flags`), `zone` (`zones.flags`). `shape` is one of `text|flag|int|number|enum|range|hot|statmap|list` and drives both the dev-panel input widget and serialization. The optional `targets` array (`['item','furniture']`) controls which dev-panel editors offer the tag and is set via the **Usable on** checkboxes on the Tags screen — a tag can be attachable on both (e.g. `broadcast_receiver`). When `targets` is absent, applicability is derived from `scope` (class→item, furniture→furniture, instance→neither). Both the item and furniture editors render the same dropdown-picker + chips UI, filtered by `tagAppliesTo(def,'item'|'furniture')`; the furniture picker stores values as flat keys in `flags`.

The applicability helpers `tagTargets(def)` / `tagAppliesTo(def, surface)` live in the **sibling** `client/shared/tagHelpers.js`, not in the catalog file.

Both shared files are written to work **as a browser global *and* as ESM**, because the dev-panel `<script>` is a classic script (not a module) while the Node engine uses `import`. `server/engine/tags.js` imports the catalog for that global side effect and exposes `hasTag(item,name)`, `tagValue(item,name,default)`, `isStackable(item)`, `hasFlag(invRow,name)`, `tagsOf(entity)`, `validateTags(bag)`, and re-exports `TAG_CATALOG`.

**SQL gate pattern:** `jsonb_exists(i.tags,'<name>')` / `i.tags ->> '<key>'`. Never the bare `?` operator — it collides with node-pg placeholders.

### Furniture capability tags vs. `object_type`

`furniture.object_type` is a single-valued **structural class** (`light`, `container`, `furniture`) with dedicated columns and subsystems behind it — keep reading those by `object_type`. **Capabilities** ("what can you do here") belong in `furniture.flags` as catalog tags, gated by verb plugins — never as magic `object_type` strings the editor dropdown can't even produce. Migrated capabilities: `toilet`, `cosmetic_machine` (new furniture tags), and `sink` → the existing `water_source` capability. The engine still reads each with a transition `OR` (`WHERE object_type='toilet' OR jsonb_exists(flags,'toilet')` — [bodily/index.js:35](../plugins/bodily/index.js), [cosmetic-machine/index.js:46](../plugins/cosmetic-machine/index.js), [doors.js:221](../server/engine/commands/doors.js)) so legacy rows keep working with no data change. `media_deck` is a flag tag already; the broadcast panel sets `flags.media_deck` on every deck, so the look-render reads the flag too. The three broadcast device tags (`broadcast_receiver`/`broadcast_transmitter`/`broadcast_device_type`) carry `targets:['item','furniture']` so the furniture editor offers them — the engine has always read them off furniture `flags`.

## API
`apiCreateItem`/`apiUpdateItem` ([routes.js:1825](../server/api/routes.js)) write `(id, name, type, weight, value, tags)`; `itemTagsFor` strips supertag bookkeeping and runs `validateTags`, throwing a 400 on an uncatalogued key or wrong shape.

## Critical Files
- `client/shared/tagCatalog.js` *(shared single source of truth)* + `client/shared/tagHelpers.js` (`tagTargets`/`tagAppliesTo`) + `client/shared/tagSupertags.js`
- `server/engine/tags.js` *(engine helpers — `tagsOf`/`hasTag`/`tagValue`/`isStackable`/`hasFlag`/`validateTags`)*
- `server/engine/supertags.js` *(`ownTags` — strips `__super`/`__own` bookkeeping)*
- `server/engine/specializedActions.js` *(Tag→Action registry — the extensibility seam, ADR-0003)*
- `server/engine/zone-tags.js` *(`getZoneRadiation`/`isSanctuary` — the `scope:'zone'` readers)*
- `server/models/schema.js` — declares the `tags` column
- `server/engine/commands/inventory.js` — most item behavior touchpoints
- `plugins/weapon/index.js` (weapon lookup), `server/engine/vendor.js`, `server/engine/crafting.js`
- `server/api/routes.js` — `apiCreateItem`/`apiUpdateItem`, `itemTagsFor`
- `client/devpanel/js/panels/items.js` — `itemEditForm`/`saveItem`/`itemTagWidget`; `client/devpanel/js/panels/tags.js` — the Tags screen
- `docs/items.md` — the per-tag reference table
