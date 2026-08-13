# Land taxonomy — the spatial concepts, and how they differ

Several different systems describe "where a tile is" and "what it's like there," and they overlap in
casual speech. This is the canonical reference for which concept is which, what its single source of
truth is, and what it must **never** be confused with.

The golden rule: **each concept has exactly one SSOT.** If you're adding a reader, read the SSOT for
the thing you actually mean — don't infer a region from a zone-id prefix, or a district from a
`region_id`.

## The one-screen map

| Concept | What it answers | Scale | SSOT | Set / derived by | Read by |
|---|---|---|---|---|---|
| **Map & grid** | *Where* is this tile in space | the whole world | `maps` table + `zones.grid_x/y/z`, `map_id` | authored (the **Studio**) | movement, minimap, flight, everything |
| **Region** | Which named world-map **place** is this (Coldwater, The Reach) | a rectangle of the grid | `regions` table + `zones.flags.region_id` | dev-panel **World Editor** | World Editor, flight target guide |
| **District** | What **neighborhood** does this *feel* like (North City, the Docks) | a cluster of zones | `server/engine/districts.js` (`DISTRICTS`) | zone-id **prefix** (or `flags.district` override) | ambience, minimap tint, move narration |
| **Terrain** | What is the **ground surface** of this one tile (road/water/grass) | a single tile | `zones.flags.terrain` | dev-panel **Terrain Painter** | minimap, flight tint, pacing (NOT passability) |
| **Biome** | What does the ground **look like from the air** | a single tile | `plugins/flight/biomes.js` (`biomeOf`) — pure classifier | inferred from id-prefix + flags + danger | flight renderer only |
| **Danger** | How **lethal** is it here | a zone | `server/engine/danger.js` (`zoneDanger`) | inferred from zone data | combat, district `hazard` fallback |

## The concepts in detail

### Map & grid — the coordinate substrate
`map_world` is the single exterior overworld; interiors are their own maps linked to a facade tile via
`maps.parent_zone_id`. A tile's position is `grid_x` / `grid_y` / `grid_z` (z is floor; `z<0` = The
Under). This is just *coordinates* — it carries no identity or character. Everything below is a
labelling layer on top of the grid. See [systems-world.md](../systems-world.md).

### Region — the spatial "place" (renamed 2026-07-19 from *district*)
A **region** is a named rectangle of the `map_world` grid — the big world-map places a pilot would
navigate toward: **Coldwater**, **The Reach**, **Terminus**, **The Scarletwastes**, **Deadwater**. SSOT is the **`regions` table**
(`id/name/base_terrain/grid_z/defaults`); member tiles point back with **`flags.region_id`**. Bounds are
derived from member tiles at read time, never stored (so moving a region can't desync them). Authored
in the dev-panel **World Editor** ("New Region", "Region Maps", drag-to-move), published through
staging (`region_create` / `region_move`). Loaded into RAM at boot (`world.regions`, `getRegion` /
`getAllRegions`, refreshed on `reloadMaps`) so runtime readers resolve a region name without a DB hit.
The flight target guide waypoints regions — see [systems-flight.md](../systems-flight.md).

**A region also says what its tiles sound like by default.** `regions.defaults` is a JSONB bag
keyed by *zone column* — the region rung of `resolveDefault`
([scripts/content/derive.mjs](../../scripts/content/derive.mjs), spec §1.3), resolved
**tile override → region default → palette → global**. Today it holds one key, `audio_theme_id`:
two authored values covering 5,237 tiles, replacing a column that was null on every one of them.
A tile overrides by setting the column; blank means inherit, and the dev panel's Audio Theme
select names what blank would give you. Most-specific wins, so a region default deliberately
outranks anything terrain-derived — refining below a region means refining the region.

> **Region > district** in scale: a region contains districts. (Regions were called "spatial
> districts" before 2026-07-19; the rename exists purely to end that collision.)

### District — the "sense of place" (land-use identity)
A **district** is the coarse land-use *feel* of a zone — **North City**, **the Docks**, **the
Redline**, **the Slaglands**.

**SSOT is the `districts` content table** — one file per district under `content/districts/`,
shipped by the ordinary CODEX deploy and edited in the **Studio's district view**. It was a
hardcoded `DISTRICTS` literal in [`server/engine/districts.js`](../../server/engine/districts.js)
until 2026-07-28; that module is now the *registry* (it loads the rows at boot and exposes
`districtFor`), not the data. Each row carries name, colour, mood blurb, landmark + skyline
phrase, and the outdoor sensory pool.

`districtFor(zone)` resolves in this order and **always returns an entry**:

1. `flags.district` — painted in the Studio, and the only rung that means anything on the
   modern grid
2. the district's `prefixes` list, matched against `zone_<prefix>_…` — **legacy**, and only
   154 zones still resolve this way. Every grid tile is `zone_district_<x>_<y>`, which matches
   nothing
3. `hazard` if the tile's danger is lethal, else `residential`

So a tile with no `flags.district` is not undecided — it reads as the Residential Blocks.
**1,150 tiles are in that state**, mostly interiors.

Drives ambient sensory beats (`plugins/district-ambience`), the room's district tag,
boundary-crossing narration, skyline landmarks, and the **regional-map** tint/legend — *not*
the tile fill at normal zoom, which is terrain's. The client's `FUNC_LEGEND` is filled from
`/api/districts` at boot; it used to be a hand-kept copy and had gone four districts stale.
**Rendering/flavour only — never gates gameplay.** See
[systems-world.md § Districts (sense of place)](../systems-world.md#districts-sense-of-place).

> **The name was reused.** Before 2026-07-19 "district" meant what is now a **region**, and
> that old `districts` table still sits in databases created back then. `SCHEMA_SQL` renames
> it to `districts_legacy` on sight (guarded on a column only the old shape has) so the new
> table can be created; drop it by hand once you've looked at it.

### Terrain — the per-tile ground surface
**`flags.terrain`** is the physical surface of one tile: `road`, `water`, `grass`, `park`, `asphalt`,
`concrete`, `dock`, `sand`, `dirt`, `scrub`… Authored in the **Terrain Painter** (dev-panel Maps),
with server/client inference (`zoneTerrain`) filling unpainted tiles. Drives the minimap look, the
flight tint, and movement *pacing* — but **not passability** and not flight collision. Nothing about
terrain blocks a step: water tiles are entered as a *swim* (`plugins/swimming`), and a `boat`-tagged
item only makes the crossing dry and free. See [systems-terrain.md](../systems-terrain.md).

### Biome — the from-the-air look (flight only)
`plugins/flight/biomes.js` `biomeOf(zone)` is a **pure, rendering-only classifier** that turns a tile
into one of `BIOMES` (`uptown`, `citycore`, `industrial`, `redrock`, `ash`, `pier`…) so the flight
renderer knows what to draw out the canopy. It reads id-prefix + a few flags + danger, and honours
`flags.terrain` via `TERRAIN_BIOME`. It **must never affect gameplay** — it's cosmetic geography for
the 3D world. See [reference/world-rendering.md](world-rendering.md).

### Danger — lethality tier
`server/engine/danger.js` `zoneDanger(zone)` classifies a zone's lethality (feeds combat, and the
district registry's `hazard` fallback for lethal zones with no prefix match). Not "land" identity, but
frequently entangled with it — listed here so it isn't mistaken for one.

### Provenance — deleted, not moved
There used to be a sixth layer here: `flags.planner` (`bp_district`), a build-time marker stamped by
the offline `tools/zone-planner` "District Editor" that generated the bulk exterior grid. Nothing in
the game ever read it — it only told that tool which tiles it was allowed to regenerate. The Studio
replaced the planner, and both the tool and the flag were **deleted 2026-08-01** (the flag off all
5,309 tiles that carried it). The grid it produced *is* now the Coldwater **region**, which is the
region layer's business. Don't reintroduce a provenance flag: a tile is authored, and which tool
typed it is not a property of the world.

## Common confusions (the whole reason this file exists)

- **Region ≠ district.** Region = the spatial place from the `regions` table (`flags.region_id`,
  World Editor). District = the land-use feel from the id-prefix (`districtFor`, `flags.district`).
  Different SSOT, different scale. A pilot waypoints **regions**; a pedestrian crosses into
  **districts**.
- **`flags.region_id` ≠ `flags.district`.** The first is spatial region membership; the second is a
  land-use override. Both exist on the same tile and mean unrelated things.
- **Water is marked ONE way: `flags.terrain = 'water'`,** and **tested one way:
  `zoneTerrain(zone) === 'water'`, never a raw flag.** The legacy `flags.water` marker and the
  `zoneTerrain()` rung that read it were both deleted 2026-07-30 — there is no second way to say it. See
  [systems-terrain.md § Water is terrain, not a flag](../systems-terrain.md#water-is-terrain-not-a-flag).
- **Terrain ≠ biome.** Terrain is the authored surface SSOT (`flags.terrain`, gameplay-adjacent).
  Biome is a flight-render-only derivation that *reads* terrain among other things.
- **District (land-use) ≠ region (spatial).** Two different meanings of a word that no longer share
  it — felt identity and named place respectively. (A third, the planner's `bp_district` blueprint,
  is gone; see above.)
- **Zone primary keys still read `zone_district_*`.** Those are opaque ids kept for exit stability;
  they do **not** imply the tile's region or district. Don't parse them for either.
