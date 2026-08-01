# Terrain Property Presets

**Status: BUILT 2026-07-30** — all five phases shipped. Deltas from the proposal are
recorded in *As built* at the foot of this doc; the body below is the design as
approved. The as-built summary lives in
[systems-terrain.md § Terrain presets GAMEPLAY properties](../systems-terrain.md).

**Supersedes:** nothing · **Touches:** `content/map/terrain.json`,
`scripts/content/derive*.mjs`, `server/models/schema.js`, `client/shared/tagCatalog.js`,
7 runtime call sites

## The goal

A terrain type carries a **preset set of properties**. A tile inherits them by being painted that
terrain, and an author can **override any one of them** on any tile without inventing a new terrain
type. Water is swimmable because it is water — but *this* stretch of water is frozen, and says so in
one flag rather than by becoming `terrain: ice`.

## Why this is smaller than it looks

The rail already exists and already carries one gameplay property:

```
content/map/terrain.json      road: { fill, glyph, auto_tile, speed_mult: 2 }    PRESET
        ↓ build — buildRenderSpec (derive.mjs:743)
zone_render.spec              { terrain, fill, text, speed_mult }                EFFECTIVE
        ↓ runtime — specOf (world.js:135)
plugins/pacing/index.js:82    return spec.speed_mult ?? 1                        READ
```

Movement speed is preset by terrain, resolved at build, and read from a derived row. Nothing at
runtime consults the palette — as `buildRenderSpec`'s header puts it, no renderer "can invent a
colour the build didn't produce." This proposal generalises that one working case; it does not
introduce a mechanism.

## The model: three layers, never collapsed

| Layer | Lives in | Written by | Read by |
|---|---|---|---|
| **Preset** | `content/map/terrain.json`, per terrain type | a human, once per terrain | the build |
| **Override** | `zones.flags`, per tile | authors (Studio), in git | the build |
| **Effective** | the derived row (below) | the build | runtime code |

Runtime reads layer 3 and never layers 1 or 2. Authors write layer 2 and never layer 3.

**The invariant, and the reason for it:** a preset is never written into layer 2. On 2026-07-21 the
`flags.water` boolean was migrated to `terrain: 'water'` — but its 12 readers stayed. Because the
flag then sat on zero rows, every `if (f.water)` answered "no" forever, and GPS plotted routes
across a 945-tile basin that each check believed it was avoiding. That is what layer collapse costs.
If painting a tile stamped `swimmable: true` into its content file, the same divergence returns the
first time a preset changes.

> The old counterpart to this rule was "the export must not round-trip derived values into content."
> With `content:export` retiring and the DB demoted to derived current state, that half is moot —
> content files are hand-authored and hold overrides only. The invariant survives as a **lint rule**
> (below), not as an export exclusion.

## 1. Rename `zone_render` → `zone_derived`

Gameplay properties riding a table called `zone_render` will mislead someone. The table is not about
rendering; it is about *everything the build resolved*. `spec` stays as the render payload, and
`props` joins it as the gameplay payload.

```sql
ALTER TABLE zone_render RENAME TO zone_derived;
ALTER TABLE zone_derived ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';
```

Idempotent form for `SCHEMA_SQL` (the rename needs a guard since `RENAME TO` has no `IF EXISTS`
on the target):

```sql
DO $$ BEGIN
  IF to_regclass('zone_render') IS NOT NULL AND to_regclass('zone_derived') IS NULL THEN
    ALTER TABLE zone_render RENAME TO zone_derived;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS zone_derived ( … );   -- full definition, for a fresh DB
ALTER TABLE zone_derived ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';
```

Call sites to follow: `world.js` (`world.render` Map, `loadZoneRender`, `renderOf`, `specOf`),
`derive-write.mjs`, `derive-cli.mjs`, `routes.js` (`loadZoneRender`), `tests/regress.js`, and the
Studio's preview. Mechanical; `renderOf`/`specOf` keep their names since they still describe what
they return.

## 2. Palette gains a `props` block

```jsonc
"water": {
  "label": "Water", "fill": "#1d3b52", "minimap_class": "water",   // render, unchanged
  "props": { "liquid": true, "swimmable": true, "routable": false, "buildable": false }
},
"road": {
  "label": "Road", "fill": "#4c5157", "speed_mult": 2,
  "props": { "routable": true, "buildable": true }
}
```

Absent `props` = `{}`; every property falls to its global default.

### The v1 property set

Four, derived from the actual call sites — not speculative:

| Property | Default | Means | Read by |
|---|---|---|---|
| `liquid` | `false` | you are **in** this tile, not **on** it | fishing (cast into / can't cast from), voidwalking (no rim) |
| `swimmable` | `false` | entering costs stamina; wetness, drowning, hypothermia apply | swimming |
| `routable` | `true` | GPS and pathfinding may cross it | pathfinding, gps ×2, movement payload |
| `buildable` | `true` | the dev-panel builder may place/move a building here | routes.js ×4 |

`speed_mult` stays where it is (`spec`) — it is already shipping and already works; moving it is
churn. New properties go in `props`.

Deliberately NOT in v1: `passable` (there is no move gate on water — swimming governs it, see
[systems-swimming.md](../systems-swimming.md)), `fishable` (fishing already gates on the authored
`fishing_table_id`; `liquid` is the only extra fact it needs).

## 3. The resolver

```js
// scripts/content/derive.mjs
export function resolveProps(zone, palette) {
  const flags   = zone?.flags || {};
  const terrain = resolveTerrain(zone);
  const preset  = (terrain && palette?.terrains?.[terrain]?.props) || {};
  const out = { ...PROP_DEFAULTS, ...preset };
  for (const key of Object.keys(PROP_DEFAULTS))
    if (key in flags) out[key] = flags[key];   // `in`, NOT truthiness — see below
  return out;
}
```

**`key in flags`, not `flags[key]`.** This is the whole reason flags are the right override rung.
`resolveDefault` documents its own hole at [derive.mjs:70](../../scripts/content/derive.mjs):

> with a nullable column there is no way for a tile to say "explicitly nothing, do not inherit" —
> absent and none are the same bytes

For booleans that hole is fatal: you could never mark one water tile non-swimmable. JSON
distinguishes absent from `false`, so `{ "swimmable": false }` is an explicit "no" and a missing key
is "no opinion, inherit." A frozen bay is:

```jsonc
"flags": { "terrain": "water", "liquid": false, "swimmable": false, "routable": true }
```

Still painted blue, still water on the map, walked across like ice. No new terrain type.

**No region rung.** `resolveDefault`'s region tier exists for ambience, where "this district sounds
like neon rain" is a real authorial statement. "This district is swimmable" is not. Two rungs only:
tile flag → terrain preset → global default. If a region tier is ever wanted, it slots in unchanged
between them.

Wire into `writeDerived` beside `buildRenderSpec`; `props` is written on the same row in the same
pass, so `map:derive` and `content:import` step 3 both keep it current with no new command.

## 4. Runtime read

```js
// server/engine/world.js
export function propsOf(zoneId) { return world.render.get(zoneId)?.props || PROP_DEFAULTS; }
```

Falling back to `PROP_DEFAULTS` rather than `{}` means a tile with no derived row behaves as
ordinary solid ground instead of as every-property-undefined.

## 5. The conversions (7 sites)

Flight is **exempt by decision** — `biomes.js` keeps reading `flags.terrain`, and the ditching crash
at [flight/index.js:980](../../plugins/flight/index.js) keeps going through `districtBiome()`.

| Site | Now | Becomes |
|---|---|---|
| [swimming/index.js:61](../../plugins/swimming/index.js) | `zoneTerrain(z)==='water' \|\| flags.underwater` | `propsOf(z.id).swimmable \|\| flags.underwater` |
| [fishing/index.js:163](../../plugins/fishing/index.js) | `isWater = zoneTerrain(z)==='water'` | `isWater = (z) => propsOf(z.id).liquid` |
| [pathfinding.js:7](../../server/engine/pathfinding.js) | `isWater(zone)` (2 uses) | `!propsOf(zone.id).routable` |
| [gps/index.js:29](../../plugins/gps/index.js) | destination is water → error | `!propsOf(destZone.id).routable` |
| [gps/index.js:166](../../plugins/gps/index.js) | `landZones` filter | `propsOf(z.id).routable` |
| [voidwalking/index.js:118](../../plugins/voidwalking/index.js) | water has no rim | `propsOf(zone.id).liquid` → no rim |
| [movement.js:769](../../server/engine/commands/movement.js) | `water:` payload | `routable: propsOf(zone.id).routable` (client reads the new key) |
| [routes.js:816,821,1193,1204](../../server/api/routes.js) | 4× water checks | `propsOf(t.id).buildable` |

`routes.js:828` and `:1261` (prefer a `road`-terrain tile for the front door) stay on `zoneTerrain` —
that is a genuine "what is this surface" question, not a capability.

Fixtures in `plugins/gps/regress.js` (×3) follow their subject.

## 6. Catalog + Studio

The four properties get `scope: 'zone'` catalog entries so the Studio generates their widgets, in a
new group **Zone: Properties**, each labelled as an override:

```js
swimmable: { label: 'Swimmable', shape: 'flag', scope: 'zone', group: 'Zone: Properties',
  preset: true,
  help: 'OVERRIDE. Normally preset by terrain (water ⇒ swimmable). Set explicitly to force it on or off — an explicit false is honoured, e.g. a frozen bay.' },
```

`shape: 'flag'` today stores presence-only `true`. These need **tri-state** — unset / true / false —
which is a new shape (`tristate`) or a `nullable: true` marker on `flag`. Without it an author can
inherit or force-on but never force-off, and the frozen bay is unauthorable.

The new `preset: true` marker lets the Studio show the resolved value and its provenance —
"Swimmable: **yes** — inherited from terrain *water*" vs "**no** — set on this tile". The pattern
already exists: `lockedFieldHtml` ([studio.js:951](../../tools/studio/studio.js)) renders
map-owned fields as shown-but-not-editable with a reason. This is that, one rung softer.

## 7. Lint

Replaces the retired export-exclusion as the guard on the invariant:

1. **Redundant override** — a tile whose flag equals its terrain's preset. Warning, not an error:
   it is how a preset silently gets baked into content, one tile at a time.
2. **Orphan override** — a property flag on a tile with no terrain and no preset to override.
3. **Unknown property** — already covered by the uncatalogued-flag check, for free.
4. **Every terrain's `props` keys are catalogued** — a typo in `terrain.json` (`swimable`) otherwise
   presets nothing, silently, on every tile of that terrain.

## 8. Regress

Add to `tests/regress.js`:

- `resolveProps` unit table: preset inherited; `false` override honoured (**the regression that
  guards the tri-state**); absent key inherits; unpainted tile gets defaults.
- Every zone has a `props` object on its derived row.
- **The 2026-07-21 guard:** for every tile with `terrain: 'water'`, `propsOf(id).swimmable === true`
  unless the tile explicitly overrides it. This is the assertion whose absence let 945 tiles disagree
  with 12 readers for nine days.

## Rollout

Each phase leaves the tree green.

1. **Rename** `zone_render` → `zone_derived`, add `props`. No behaviour change.
2. **Palette + resolver + `propsOf`.** Props are written and readable; nothing reads them yet.
3. **Catalog + tri-state shape + Studio.** Overrides authorable, still unread.
4. **Convert the 7 sites**, one commit per plugin, regress between.
5. **Lint + regress rules.** Close the door behind it.

Phases 1–3 are additive and independently shippable. Phase 4 is where behaviour moves, and it is the
one to review tile-by-tile — `npm run test:regress` is the gate on every phase.

## Open questions

1. ~~**Tri-state shape**~~ — **RESOLVED, built as `shape: 'tristate'`.** The alternative
   (`nullable: true` on `flag`) would have made every one of the ~60 existing `flag` entries
   ambiguous at the validator, because `flag` meaning "presence-only true" is load-bearing in
   `shapeError` and both editors. A separate shape leaves them untouched.
2. ~~**`liquid` vs `swimmable`**~~ — **RESOLVED, both kept.** They answer different questions:
   fishing and voidwalking ask "is this a body of liquid", swimming asks "may I swim here". A
   flooded basement wants the second without the first, and collapsing them loses it.
3. ~~**Does `underwater` become a property too?**~~ — **RESOLVED, built, plus a new terrain.** The
   blocker was that no terrain presets it. Answer: give it one. `underwater` is now a terrain that
   paints *identically* to `water` (same fill, same minimap class) — the difference is what it does
   to you, not what it looks like — and presets `underwater`/`liquid`/`swimmable`. The 82 tiles that
   carried `terrain:'water'` **plus** an `underwater` flag were migrated to `terrain:'underwater'`,
   deleting the second fact. `isUnderwater` and `waterTemperature` read the property.

4. ~~**Should `marsh` preset `liquid`/`swimmable`?**~~ — **RESOLVED: no.** A marsh is walked, not
   swum. Locked by a regress assertion so it does not drift in later by accident.

5. ~~**Should `speed_mult` move from `spec` to `props`?**~~ — **RESOLVED, moved.** This is what
   introduced **numeric properties**: `PROP_DEFAULTS` now types each key by its default, and
   `coerceProp` sends numbers through `Number()` rather than the boolean `!!` that would have turned
   `speed_mult: 2` into `true` and put every road back at walking pace. Its catalog shape is
   `number`, not `tristate` — a number already distinguishes absent from set, so the tri-state
   problem turns out to be a boolean problem only. A tile can now make one rutted lane slow without
   inventing a terrain. Regress asserts it no longer rides `spec`, so there is one home, not two.

6. ~~**Should the two `road` front-door checks become a property?**~~ — **RESOLVED, built as
   `frontage`.** Preset on `road` only, which preserves the old `zoneTerrain(x) === 'road'` behaviour
   exactly (`dirt_road` was never preferred and still isn't — a regress assertion pins that). With
   these two gone, **`zoneTerrain()` has no gameplay callers left**: its only two remaining callers
   are the minimap/movement payloads, which is what it was always for.

7. ~~**Should `dirt_road` or `asphalt` get `frontage`?**~~ — **RESOLVED: no.** A front door faces a
   proper street. `road` is the only terrain that presets `frontage`, and the regress assertion that
   `dirt_road` does not is now a rule rather than an accident of the code it replaced.

**No open questions remain.**

## As built — deltas from the proposal

Five things differed from the plan. Each is a decision, not a slip.

1. **`shape: 'tristate'` won open question 1.** `flag` meaning "presence-only true" is load-bearing in
   `shapeError` and both editors, so overloading it would have made every existing flag ambiguous.
   Three editors learned the shape: the shared validator (`server/engine/tags.js`), the Studio
   (3-way select), and the dev panel. `tristate` also had to be added to regress's `KNOWN_SHAPES`
   set — which exists precisely to catch a catalogued shape nothing validates, and duly caught it.

2. **The `water:` movement payload was deleted, not renamed.** The plan was to rename it `routable`.
   Grepping for its consumer found none: the minimap styles water off `terrain` and the auto-walker
   follows the server's own route. It had been dead payload restating a server decision, so it went.

3. **`marsh` was NOT given props.** Presetting 101 marsh tiles `liquid`/`swimmable` is a content
   decision about what a marsh IS, not a refactor, and the rollout was meant to be behaviour-
   preserving. `water` is the only terrain carrying a `props` block. Marsh remains available.

4. **Test fixtures had to supply their own derived rows.** Three suites (fishing, swimming,
   voidwalking) inject synthetic zones into `world.zones`. Those have no `zone_derived` row, so
   `propsOf` returned defaults and a `terrain:'water'` fixture read as dry land — inverting six
   assertions. Fixtures now inject the row the build would have written. This is the general shape of
   the runtime contract: **properties live on the derived row, so a zone that was never built has
   none.** Real zones always have one (regress asserts it); transient zones are out of scope by
   decision. The GPS fixture had a related problem — its tile pool filtered on the deleted
   `flags.water`, so it could hand the probe an unroutable destination GPS then correctly refused.

5. **Lint exempts `preset: true` entries from the "catalogued but on no tile" warning.** A property
   override is *supposed* to be absent from nearly every tile. Listing the four as dead flags would
   invite exactly the cleanup this mechanism exists to prevent — someone deletes the catalog entry,
   the palette keeps presetting a key nothing validates, and preset and readers drift apart again.
   That is the `flags.water` failure with the arrow reversed.

**Verification.** All 12 new regress checks pass against a live 5,838-zone world, including the
frozen-bay tri-state and the 945-tile water guard. `content:lint` clean at its prior 27 warnings.
The 12 remaining regress failures are a pre-existing local-DB/content divergence — several name zones
(`zone_adequate_floor`, `zone_solenne_apt_d`, `zone_citadel_hall`) and flags (`citadel_public`,
`airfield_residents_only`) that exist only in the DB and have no content file at all.
