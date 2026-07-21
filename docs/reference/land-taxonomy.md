# Land taxonomy — the spatial concepts, and how they differ

Several different systems describe "where a tile is" and "what it's like there." They overlap in
casual speech (and historically overloaded the word *district*), which caused real confusion and a
rename. This is the canonical reference for which concept is which, what its single source of truth
is, and what it must **never** be confused with.

The golden rule: **each concept has exactly one SSOT.** If you're adding a reader, read the SSOT for
the thing you actually mean — don't infer a region from a zone-id prefix, or a district from a
`region_id`.

## The one-screen map

| Concept | What it answers | Scale | SSOT | Set / derived by | Read by |
|---|---|---|---|---|---|
| **Map & grid** | *Where* is this tile in space | the whole world | `maps` table + `zones.grid_x/y/z`, `map_id` | authored / planner | movement, minimap, flight, everything |
| **Region** | Which named world-map **place** is this (Coldwater, The Reach) | a rectangle of the grid | `regions` table + `zones.flags.region_id` | dev-panel **World Editor** | World Editor, flight target guide |
| **District** | What **neighborhood** does this *feel* like (North City, the Docks) | a cluster of zones | `server/engine/districts.js` (`DISTRICTS`) | zone-id **prefix** (or `flags.district` override) | ambience, minimap tint, move narration |
| **Terrain** | What is the **ground surface** of this one tile (road/water/grass) | a single tile | `zones.flags.terrain` | dev-panel **Terrain Painter** | minimap, flight tint, pacing (NOT passability) |
| **Biome** | What does the ground **look like from the air** | a single tile | `plugins/flight/biomes.js` (`biomeOf`) — pure classifier | inferred from id-prefix + flags + danger | flight renderer only |
| **Danger** | How **lethal** is it here | a zone | `server/engine/danger.js` (`zoneDanger`) | inferred from zone data | combat, district `hazard` fallback |
| **Provenance** | Which **tool built** this grid | a generated slice | `zones.flags.planner` (e.g. `bp_district`) | `tools/zone-planner` | nobody at runtime — it's a marker |

## The concepts in detail

### Map & grid — the coordinate substrate
`map_world` is the single exterior overworld; interiors are their own maps linked to a facade tile via
`maps.parent_zone_id`. A tile's position is `grid_x` / `grid_y` / `grid_z` (z is floor; `z<0` = The
Under). This is just *coordinates* — it carries no identity or character. Everything below is a
labelling layer on top of the grid. See [systems-world.md](../systems-world.md).

### Region — the spatial "place" (renamed 2026-07-19 from *district*)
A **region** is a named rectangle of the `map_world` grid — the big world-map places a pilot would
navigate toward: **Coldwater**, **The Reach**. SSOT is the **`regions` table**
(`id/name/base_terrain/grid_z`); member tiles point back with **`flags.region_id`**. Bounds are
derived from member tiles at read time, never stored (so moving a region can't desync them). Authored
in the dev-panel **World Editor** ("New Region", "Region Maps", drag-to-move), published through
staging (`region_create` / `region_move`). Loaded into RAM at boot (`world.regions`, `getRegion` /
`getAllRegions`, refreshed on `reloadMaps`) so runtime readers resolve a region name without a DB hit.
The flight target guide waypoints regions — see [systems-flight.md](../systems-flight.md).

> This used to be called a "spatial district" (`districts` table, `flags.district_id`). It was
> renamed to **region** to end the collision with the land-use district below. **Region > district**
> in scale: a region contains districts.

### District — the "sense of place" (land-use identity)
A **district** is the coarse land-use *feel* of a zone — **North City**, **the Docks**, **the
Redline**, **the Slaglands**. SSOT is [`server/engine/districts.js`](../../server/engine/districts.js):
`districtFor(zone)` returns a `DISTRICTS` entry, keyed off the **zone-id prefix** (`zone_<prefix>_…`
via `DISTRICT_PREFIX`), with a `flags.district` string as an explicit override. It's a *derived*
identity — there is no district table and no per-tile district id. Drives ambient sensory beats
(`plugins/district-ambience`), the minimap colour/legend (`FUNC_LEGEND`), boundary-crossing narration,
and skyline landmarks. **Rendering/flavour only — never gates gameplay.** See
[systems-world.md § Districts (sense of place)](../systems-world.md#districts-sense-of-place).

### Terrain — the per-tile ground surface
**`flags.terrain`** is the physical surface of one tile: `road`, `water`, `grass`, `park`, `asphalt`,
`concrete`, `dock`, `sand`, `dirt`, `scrub`… Authored in the **Terrain Painter** (dev-panel Maps),
with server/client inference (`zoneTerrain`) filling unpainted tiles. Drives the minimap look, the
flight tint, and movement *pacing* — but **not passability** (open water needs a `boat`-tag item via a
separate gate) and not flight collision. See [systems-terrain.md](../systems-terrain.md).

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

### Provenance — how a grid was generated (`bp_district`, zone-planner)
`flags.planner` (e.g. `bp_district`) is a **build-time provenance marker** stamped by the offline
[`tools/zone-planner`](../../tools/zone-planner/) "District Editor" that generated the bulk exterior
grid (the 888-zone Coldwater slice). It is **not** a runtime land concept — nothing reads it in the
game loop; it only tells a tool "I generated this, I may reassert my geometry." The tool keeps its
original name and the `bp_district` marker was intentionally left unrenamed. The grid it produced *is*
now the Coldwater **region**, but that is the region layer's business, not the planner's.

## Common confusions (the whole reason this file exists)

- **Region ≠ district.** Region = the spatial place from the `regions` table (`flags.region_id`,
  World Editor). District = the land-use feel from the id-prefix (`districtFor`, `flags.district`).
  Different SSOT, different scale. A pilot waypoints **regions**; a pedestrian crosses into
  **districts**.
- **`flags.region_id` ≠ `flags.district`.** The first is spatial region membership; the second is a
  land-use override. Both exist on the same tile and mean unrelated things.
- **Water is marked ONE way: `flags.terrain = 'water'`.** There used to be two. The Coldwater
  Basin carried a legacy `flags.water: true` with `terrain` unset, while the wildlands hydrology
  (two corner seas plus a river) carried `terrain: 'water'` with no flag — two markers that shared
  **zero tiles** and so disagreed at every consumer that picked one. GPS route-blocking read
  `flags.water`, so it routed players straight across the river; fishing had to pick a side. The
  256 basin tiles were migrated on 2026-07-21 and `flags.water` now exists on nothing — the
  `zoneTerrain()` fallback that reads it is kept only for hand-authored legacy content. **Test
  water with `zoneTerrain(zone) === 'water'`, never a raw flag.**
- **Terrain ≠ biome.** Terrain is the authored surface SSOT (`flags.terrain`, gameplay-adjacent).
  Biome is a flight-render-only derivation that *reads* terrain among other things.
- **`bp_district` (planner) ≠ district (land-use) ≠ region (spatial).** Three different meanings of a
  word that no longer all share it — provenance marker, felt identity, and named place respectively.
- **Zone primary keys still read `zone_district_*`.** Those are opaque ids kept for exit stability;
  they do **not** imply the tile's region or district. Don't parse them for either.
