# Terrain & the Terrain Painter (as built)

Terrain is the **ground surface** of a zone tile (road, concrete, grass, water,
dock…). It is authored per-zone in `flags.terrain` (a single string) and painted
through a dev-panel Maps mode. Terrain blocks a step in **exactly one** case: `cliff`, whose
`props.passable` is false ([High ground](#high-ground-cliff--plateau--ramp-2026-08-12)). Everything
else is entered — water is a *swim* ([plugins/swimming](../plugins/swimming/index.js)), never a wall.
The engine's move gates are encumbrance, door locks, and `engine:impassable-terrain`
([movement.js](../server/engine/commands/movement.js)).

Since 2026-07-30 terrain is **presentation + a preset set of gameplay properties**
that a tile can override — see [Terrain presets GAMEPLAY
properties](#terrain-presets-gameplay-properties-2026-07-30) below, which is the part
gameplay code actually reads.

## Water is terrain, not a flag

Mark open water with **`flags.terrain = 'water'`** and nothing else (submerged tiles
below it are `terrain:'underwater'`). Gameplay does **not** read it back with
`zoneTerrain()` any more — swimming, fishing, GPS route-blocking, the void rim and
the building placer all ask for the resolved *property* they mean
(`propsOf(id).swimmable`, `.liquid`, `.routable`, `.buildable`), so one stretch of
water can behave differently without lying about what it is. Only the flight biome
classifier still reads `flags.terrain` directly, deliberately.

The trap, now closed: `flags.water` was a second, parallel water marker that shared **zero tiles**
with `terrain:'water'`. The 2026-07-21 migration emptied the flag but left its READERS in place —
so `if (f.water)` in pathfinding, GPS, and the building placer became a silent no-op, and routes
were plotted straight across a 945-tile basin that every check believed it was avoiding. On
2026-07-30 the readers were converted to `zoneTerrain()`, the flag was deleted from the catalog,
and the `resolveTerrain()` fallback rung was removed. There is exactly one marker now. Don't
reintroduce it. See [reference/land-taxonomy.md](reference/land-taxonomy.md).

The lesson worth keeping: **retiring a flag means deleting its readers in the same change.** An
emptied flag whose `if` survives doesn't fail loudly — it quietly answers "no" forever.

## `flags.terrain` — the SSOT

Canonical values live in **[content/map/terrain.json](../content/map/terrain.json)** — the one place a
terrain's look is written down, and the input to the build's derive pass. There used to be three
hardcoded copies (`TERRAIN_TYPES` in the dev panel, `TERRAIN_FILL` in the minimap, `TOS_TERRAIN_FILL`
in the tablet) and they had drifted: redrock was `#9e4a30` in the editor and `#6f3524` in the game, so
on 2,996 tiles the map an author painted was not the map a player saw. All three are deleted.

**Nothing reads the palette at runtime.** `content:import` feeds it to `deriveWorld`
([scripts/content/derive.mjs](../scripts/content/derive.mjs)), which resolves every tile into a
`zone_derived` row; every renderer paints from `spec` and computes nothing. Fills below are the file's
current values — the file is authoritative, this table is a convenience.

| key | label | fill |
|---|---|---|
| `road` | Road | `#4c5157` asphalt + yellow markings |
| `dirt_road` | Dirt Road | `#7d6236` — auto-tiles with `road` (`isRoadTerrain`), drawn as a packed-dirt recolour of the same connector piece |
| `asphalt` | Asphalt | `#45484d` |
| `concrete` | Concrete | `#8a8d91` |
| `grass` | Grass | `#2f3a26` |
| `park` | Park | `#46a24e` manicured green + authored flight-sim dressing |
| `forest` | Forest | `#1e3a22` closed woodland — a full stand of trees per tile in the flight sim (`drawForestTile`), not the parkland lone tree |
| `dirt` | Dirt | `#6b5138` |
| `sand` | Sand | `#c2b280` |
| `gravel` | Gravel | `#7d7a73` |
| `dock` | Dock | `#6e5636` wooden decking |
| `water` | Water | `#1d3b52` — the same value as `WATER_VOID_FILL` ([minimap.js:942](../client/game/js/panels/minimap.js:942)), which is what paints the bay BEYOND the map's rim, so the edge of the world is seamless |
| `underwater` | Underwater | `#14283a` — a shade darker than water: depth, seen from above. Shares water's `minimap_class`, and the difference that matters is still behavioural (breath timer, colder, dark) |
| `scrub` | Scrubland | `#6f7248` dry brush tufts (wildlands) |
| `redrock` | Red Rock | `#6f3524` rust mesa facets (wildlands) |
| `ash` | Ash | `#4f4b47` burnt-grey flecks (wildlands) |
| `marsh` | Marsh | `#4d5a30` toxic murky ripples (wildlands) |
| `hardpan` | Hardpan | `#b8ab90` cracked pale lakebed (badlands accent) |
| `alkali` | Alkali Flat | `#d9d5c8` near-white salt crust — the brightest ground in the palette, on purpose (badlands accent) |
| `basalt` | Basalt | `#33323a` frozen lava rock — the darkest ground in the palette, on purpose |
| `deadwood` | Dead Stand | `#4a4034` trees that died standing — the mirror of `forest` |
| `sinter` | Sinter Crust | `#c9b878` the pale mineral apron a hot spring lays down. `buildable:false` |
| `hotspring` | Hot Spring | `#3f8b84` geothermal water — swimmable, `routable:false`, and the only terrain carrying `thermal` |
| `plateau` | Plateau | `#7a4029` the tableland on top of a massif — walkable (see [High ground](#high-ground-cliff--plateau--ramp-2026-08-12)) |
| `ramp` | Ramp | `#9a6238` the break in a rim that lets you up — walkable |
| `cliff` | Cliff Face | `#5c3224` the rim itself. **The only terrain in the game a body cannot enter**: `passable:false, routable:false, buildable:false` |

**Runways** are a special case in the palette but **not** a `flags.terrain` value. The two directional
runway swatches (`Runway ↕ N-S`, `Runway ↔ E-W`, `RUNWAY_KEYS` in [maps.js](../client/devpanel/js/panels/maps.js))
write `flags.runway` (`ns`/`ew`) + `flags.icon` (`runway_ns`/`runway_ew`) + the canonical yellow-marking
(`#f5d400`) / asphalt (`#2b2b2b`) / bar-marker presentation, exactly how the seeded runway tiles carry it —
so [`runwayFor()`](../plugins/flight/state.js) reads the painted strip as a field's real departure runway and
the 2-D map draws the runway icon. Brush/rect/pick/erase all handle them via `_setTileSurface`/`_tileSurfaceKey`;
the surface still infers as `road` for pacing/road-autotiling ([world.js:217](../server/engine/world.js)). Publish, then
**⟳ Re-bake flight sim** so the baked snapshot picks the new runway up.

The four **wildlands** surfaces (`scrub`/`redrock`/`ash`/`marsh`, added for the post-apocalyptic wilds
beyond the Curtain) once formed a `GLYPH_TERRAIN` set — the only textured terrains allowed to keep
what stood on them, while every other painted surface blanked its tile to a clean expanse. That
blanking was a bug, not a feature: it deleted authored `flags.icon` art and building labels along
with the marker text, which is how painting the Fisherman Statue's square `park` deleted the statue.
**Terrain now paints the ground *under* the icon layer on every surface**, so the set is gone and
these four are no longer special. They map to their own
arid flight biomes — `scrub`→`scrub`, `redrock`→`redrock`, `ash`→`ash` (dry-land tints, never water) —
while `marsh`→`badlands`, in [biomes.js](../plugins/flight/biomes.js).

The **badlands accents** (`hardpan`/`alkali`, and originally `cliff`) were added to break up the
Scarletwastes. Each takes its own flight biome rather than borrowing `badlands`, because the whole
point of painting one is that it reads as different ground from the air, and each scatters at its own
density (`alkali` very nearly bare — a salt flat that sprouts a bush stops reading as poisoned).
`hardpan` and `alkali` are still palette entries only. **`cliff` no longer is**, on both counts: the
Scarletwastes landform pass paints it, and it scatters nothing because it is a raised mass now rather
than a tint with rocks on it. See below.
## The volcanic set: `basalt` + `deadwood` + `sinter` + `hotspring` (2026-08-12)

Four surfaces added for Deadwater, whose reservoir is now geothermal. **They are SURFACES, not
elevation** — height is the cliff/plateau/ramp trio and nothing else, so a region can be volcanic and
flat, or red and mountainous, without either vocabulary knowing about the other.

- **`basalt`** — frozen lava rock, the darkest ground in the palette on purpose. A volcanic flat that
  reads as merely "grey" is `ash` again. Scatters at `redrock` density: a lava field is strewn with
  the stuff it froze out of.
- **`deadwood`** — the exact mirror of `forest`. `drawDeadStand` is `drawForestTile` with the snag
  billboard the ash flats already scattered one of, denser at the same seed (nothing thinned these)
  and never a conifer, because a dead conifer keeps no shape worth drawing. Deliberately **not** in
  `GRASS_BIOMES`: a dead stand stands on dust, and the vegetation mottle would green it.
- **`sinter`** — the pale mineral apron a spring lays down. `buildable: false`, because a crust over
  a vent is not a foundation. Nearly bare scatter, like the alkali flat it resembles.
- **`hotspring`** — geothermal water. Counts as water in the ground LUT (it takes the water material,
  not teal dirt) and cannot drag sea off-map with it, since `fillOffMap` only seeds ocean from water
  north of `BAY_SHORE_Y`. Steam plumes on every other tile, so it reads as water venting in places
  rather than as a fog bank.

### `props.thermal`, and the system it deliberately doesn't add

`thermal` (default `false`) is read by exactly one function, `waterTemperature()`, which returns a
flat **39 °C** and ignores the seasonal derivation entirely — what heats a spring is *under* it, so
an offset on a seasonal curve would be the wrong shape, and the point is that it is warm in winter.

That single number is the whole feature. `gameLoop` already uses `waterTemperature` as the effective
ambient **while submerged**, so a spring warms you through the ordinary body-temperature model, with
wet clothing and insulation working exactly as they do in cold water. **No buff, no timer, no second
warming system.** It is not scalding either, because there is no damage channel behind it — a spring
that should hurt authors `water_temp_c` and gets it, since that check runs first.

**Trap:** a transient zone (`registerTransientZone`) has no derived row, and `propsOf` documents that
the terrain *preset* rung is unreachable from the engine — it needs the palette, a build-time input.
So a transient hot spring must pass `thermal: true` as a flag; the terrain name alone does nothing
there. Real tiles get it from the build.

## High ground: `cliff` + `plateau` + `ramp` (2026-08-12)

**Superseding the paragraph above for `cliff`**: it was a palette entry nothing painted, `routable:false`
and walkable anyway. It is now a landform, and it is **the only ground in the game a body cannot enter**.

Three terrains, one landform, split by what they answer rather than by what they look like:

| terrain | fill | passable | what it is |
|---|---|---|---|
| `plateau` | `#7a4029` | yes | the tableland on top |
| `cliff` | `#5c3224` | **no** | the rim you cannot climb |
| `ramp` | `#9a6238` | yes | the break in the rim that lets you |

All three are `auto_tile_family: "cliff"`. **The family is the LANDFORM, not the terrain** — a rim tile
counts the tableland behind it as its own kind and draws no face inward. Give the top a family of its
own and every massif gets a second outline drawn one tile inside the first.

### The three seams it rests on

- **`props.passable`** (default `true`, new) — read by exactly one law, the `engine:impassable-terrain`
  move gate in [movement.js](../server/engine/commands/movement.js). It exists so a paint stroke can
  shape where players walk **without anybody editing an exit graph**: drag a run of cliff across a map
  in the Studio and the map now has a pass in it. Everything else that stops you is mass
  (`building_type`) or a missing exit, and both are authored per tile by something that knows the whole
  map. **The graph stays true** — the tiles are still adjacent, derive still projects the edge, the
  minimap still draws the join; the refusal happens at the move. Deleting edges instead would mean a
  terrain stroke silently rewrites world geometry, and repainting would not restore it.
  `getConnectedDestinations` ([describe.js](../server/engine/commands/describe.js)) drops impassable
  destinations from the player-facing exit list, so a funnel does not offer four ways and refuse three.
  **No climb and no gear exemption, deliberately** — a wall you can sometimes get over is a difficulty
  check, not a funnel, and the value of the feature is that the ways through are legible. If a climb is
  ever wanted it goes in that gate as one named exemption, the way `bypassEncumbrance` is.
- **`auto_tile_family`** ([derive.mjs](../scripts/content/derive.mjs)) — a second piece set.
  **The letters are the sides that JOIN, in every family, always**: a road draws arms toward its own
  kind, a cliff draws a face where its own kind stops. One payload, one meaning, two directories of
  SVGs; the inversion lives entirely in the art, which is why a second family cost 16 files and no
  branch. `featureProvenance`'s stale test is now same-family-by-name rather than `startsWith('road_')`,
  or every hand-pinned cliff piece would read as current forever.
- **`hi` + `cf` on the flight cell** ([state.js](../plugins/flight/state.js)) — high ground, and the
  sides it continues on, exactly as `rd` is for road and `cur` for the Curtain. `drawCliffMass`
  ([windshield.js](../client/game/js/panels/windshield.js)) caps every `hi` tile and walls only the
  sides missing from `cf`, so a painted blob raises **one merged massif**: the only vertical surfaces
  are on its outline. Three things make it read as terrain rather than as crates — **full tile width**
  (`draw3DBoxAt`'s ±0.44 setback is right for buildings and wrong for ground: at ±0.44 adjacent tiles
  show a lit seam between them), **strata at fixed height fractions** so beds line up across tiles, and
  **the top always capped** including on interior tiles, or the plateau is hollow from above.
  Rendering only: **CFIT reads building mass, not terrain**, so a pilot may still fly through a mesa.

### The top is not a constant

`CLIFF_H` alone gave every tableland in the world the same height and every rim a dead-level top
running to the draw distance — an extruded stamp, not country. `cliffHeightAt(wx, wy)` varies it
smoothly with **world position and nothing else** (0.39–0.65 world-z, period ~13 tiles), so massifs
differ from each other and a long escarpment rises and falls along its length.

It has to be a function of position rather than of the tile or a seed, because **two adjacent tiles
must agree about the height of the edge they share without either being told about the other**. The
neighbour step that leaves is at worst 4.4% of a full cliff.

That undulation costs one thing, and it is paid: where high ground continues but this tile is the
taller of the two, the difference is an open sliver you would **see straight through into the inside
of the massif**. So a short step face is drawn from the neighbour's height up to ours, and only in
that direction — the lower tile draws nothing, so each step is drawn exactly once by whichever side
owns it. A step takes the plain fill and the bright rim line but no strata: three beds on a sliver a
few percent of a tile tall is noise.

**Nothing generates cliffs beyond the map rim.** `fillOffMap` only ever emits `scrub`/`redrock` into
the wildlands fill, and `drawCliffMass` is driven by `hi`, which exists only on real map cells — so a
massif can never run procedurally to the horizon.

`ramp` must be high ground rather than open ground beside it: the outline comes from adjacency, so a
ramp that counted as low would have the tableland behind it draw a wall straight across the only way
up. It gets a paler fill instead, because the map is where a funnel is actually read.

Built into [build-scarletwastes.mjs](../scripts/build-scarletwastes.mjs), where the mesa rim becomes
cliff and the passes come from a **second continuous noise field** — a threshold on noise clusters into
two or three walkable tiles you can see from a distance and aim for, where a per-tile hash would scatter
single-tile pinholes and funnel nobody. A flood-fill pass then **guarantees every massif has a way up**
(a sealed tableland is unreadable: "no way up here" has to imply "so there is one somewhere else").

`park` is a **manicured** green (distinct from feral `grass`): it maps to its own `park` flight biome
(designed park — benches, ponds, groves) where `grass`→`parkland` (feral single tree). A park tile can
carry `flags.park_feature` (`grove`/`pond`/`benches`/`flowerbeds`/`path`) to force *which* dressing the
flight-sim draws for that tile, so a park can be laid out symmetrically instead of by position-hash;
unset falls back to the tile's position hash. `park_feature` rides the flight cell as `pf` (both the live
stream and the baked snapshot — see [Flight](#runtime-consumption) below). Fisherman's Green (the statue
3×3) is the first park.

### Server resolution — `zoneTerrain(zone)` ([world.js:204](../server/engine/world.js))

Authored value wins; otherwise the surface is **inferred** so un-backfilled DBs
(prod) still render sensibly:

1. `flags.terrain` (SSOT) →
2. `flags.pier` → `dock`
3. `flags.icon` matching `/^(road_|runway_)/` → `road`
4. a building footprint (`buildingIconSvg` truthy) → `null` (not terrain)
5. green-dominant `bg_color` → `grass`
6. else `null`

(`flags.water` was rung 2 until 2026-07-30. It is gone — see the trap above.)

Companions in `world.js`: `roadConnector()` auto-tiles a road tile's connector
SVG from orthogonal road neighbours; `tileIconSvg()` returns an authored
icon/rooftop first, else the road connector for `terrain==='road'`. The `terrain`
string is emitted on every map/minimap node ([world.js:921](../server/engine/world.js), inside
`getMinimapData`) and the movement/look payload ([movement.js:773](../server/engine/commands/movement.js)).

## Terrain presets GAMEPLAY properties (2026-07-30)

Terrain is no longer only presentation + pacing. A terrain type **presets a set of
gameplay properties**, and a tile **overrides any one of them** with a flag of the
same name — so a frozen bay is `terrain:'water'` + `swimmable:false, routable:true`:
still blue on the map, walked across, no new terrain type invented. Full design in
[proposals/terrain-property-presets.md](proposals/terrain-property-presets.md).

| property | default | means | asked by |
|---|---|---|---|
| `liquid` | `false` | you are **in** the tile, not **on** it | fishing, voidwalking (no rim) |
| `swimmable` | `false` | stamina, wetness, drowning, hypothermia | swimming |
| `underwater` | `false` | submerged below a surface tile: breath timer, colder, dark | swimming, `waterTemperature` |
| `thermal` | `false` | this water is geothermally **heated** | `waterTemperature()` |
| `passable` | `true` | a body may **enter** the tile at all — `cliff` is the one no | the `engine:impassable-terrain` move gate, the exit list |
| `routable` | `true` | GPS/pathfinding may cross it | pathfinding, GPS |
| `buildable` | `true` | the dev-panel builder may place here | the map API |
| `frontage` | `false` | a street a building's front door may face onto | the map API |
| `speed_mult` | `1` | movement pacing multiplier | pacing |

Only `water`, `underwater`, `road` and `dirt_road` diverge from the defaults, so
they are the only terrains carrying a `props` block — silence means "all defaults".
**Gameplay never asks what a tile is painted**; it asks `propsOf(zone.id).swimmable`.
`zoneTerrain()` now has exactly two callers, both of them map payload. The one
deliberate exception is the flight sim, which keeps reading `flags.terrain` directly
(biomes, windshield road auto-tiling).

Boolean overrides are `shape: 'tristate'` in the catalog, not `flag`, because the
override has to be able to say **no** — with `flag`, absent and false are the same
signal and the frozen bay is unauthorable. `speed_mult` is `shape: 'number'`: a
number already tells absent from set, so the tri-state problem is a boolean problem
only. Every property is typed by its default in `PROP_DEFAULTS` (`derive.mjs`), and
that type is enforced at both the palette (`content:lint`) and the resolver.

**`underwater` is a terrain, not a flag** (since 2026-07-30). It paints identically
to `water` — same fill, same minimap class — because the difference is what it does
to you, not what it looks like. The 82 tiles that used to carry `terrain:'water'`
*plus* an `underwater` flag were migrated to `terrain:'underwater'`: two facts saying
one thing is the exact shape of the `flags.water` bug above.

## Dev-panel Maps editor

All in [client/devpanel/js/panels/maps.js](../client/devpanel/js/panels/maps.js)
(staging via [core/staging.js](../client/devpanel/js/core/staging.js)). Terrain
block starts ~`:1026`.

- **Terrain paint mode** — `toggleTerrainMode()` (`:1093`), floating top-right
  palette `terrainPanelHtml()` (`:1521`). State: `mapTerrainMode`,
  `mapTerrainType` (def `road`), `mapTerrainTool`. The four map modes
  (paint / safe-zone / terrain / move-building) are mutually exclusive.
- **Tools:** **Brush** `_terrainBrush()` (drag-paint; ctrl/right-click erases),
  **Flood-fill** `terrainFill()` (BFS over the *visible* surface),
  **Eyedropper** `terrainPick()`, **Rectangle-select**
  `terrainRectStart/Over/Commit` (marquee applies the brush to every covered cell).
- **Paint terrain into existence** — on the **district exterior** grid (gated on
  `dbbox`), an empty ("black") cell is paintable: **Brush** (`terrainCreateStart/Over`
  → `_terrainCreateAt` → `_conjureTileLocal`) or **Rect** (`_terrainRectCommitXY`)
  conjure a minimal ground zone (`zone_district_<x>_<y>`, `_newTerrainTile` +
  `TERRAIN_TILE_DEFAULTS`) carrying the brushed surface, auto-wired reciprocally to
  orthogonal **non-building** neighbours (mirrors drag-place; never punches into a
  building) and staged as a zone `create`. Wildlands surfaces
  (`redrock`/`scrub`/`ash`/`marsh`) become wilds ground (`district:'wilds'` +
  `radiation`). In terrain mode the grid also opens **+6 empty rows to the south**
  so the wilds can be extended past their current edge.
- **Preview mirror** — `mapZoneTerrain()` (`:1108`) mirrors server `zoneTerrain`
  so the editor previews the true surface (incl. inference) even before backfill;
  road tiles preview their auto-tiled connector via `mapRoadConnector()`.
- **Staging** — every stroke stages a single-flag PATCH through the Changes
  panel; nothing goes live until Publish. `_mapPendingOverrides` merges `terrain`
  into `flags` on apply.
- **Untyped tiles** — tiles touch on a plain `110px × 76px` grid and connections
  auto-wire on drag. In terrain mode a tile with no known/inferred terrain falls
  back to its authored `bg_color` (via `zoneColorStyle`) instead of rendering as a
  blank hole.

### Move Building flow

`toggleMoveBuildingMode()` (`:1616`): click a building tile to arm, click an
empty destination cell → `moveBuildingPropose()` POSTs `/maps/move-building`
(server `apiMoveBuilding`, [routes.js:1153](../server/api/routes.js) — validates
the destination is empty with an adjacent street, prefers a road-terrain
neighbour). Staged as one grouped `building_move` change that publishes
atomically; interior rooms + front door move with the facade.

### New Building generator (templated, by type)

`toggleNewBuildingMode()` (`:1698`) in [maps.js](../client/devpanel/js/panels/maps.js) (the **🏗 New
Building** toolbar toggle + floating type/name palette): pick a `building_type`, click a
ground/empty cell → `buildBuildingPropose()` POSTs `/maps/build-building` (server
`apiBuildBuilding`, [routes.js:790](../server/api/routes.js)). In one shot the server converts the
ground tile (or fills the empty cell) into a **facade** (`building_type` + `facade` tag → its
map icon via `BUILDING_TYPE_ICON`), stamps a **templated interior** (lobby + rooms + thematic
furniture + an optional inhabitant NPC), **powers & lights** it via
[`authorUtilityRoom`](../tools/lib/utility-room.mjs) (utility room + junction box + per-room light
fixtures), and wires the **front door** onto the adjacent street (lobby exit back out = the
compass dir opposite the fronting street, per [flags-keys](flags-keys.md)/the memory rule). The
per-type blueprints live in [tools/lib/building-templates.mjs](../tools/lib/building-templates.mjs)
(`templateForType`, synonym-aware, `GENERIC` fallback). **Hangars** reuse the same flow and
additionally get `hangar_interior`/`hangar_ramp` + `hangar_interior_zone` wiring and the
`the flight-ops desk chair` furniture (name matched by `plugins/flight/charter.js`) — but not an
`airfield_id`, so a generator-placed hangar is a *structural* hangar; pair it with a painted
runway + an `airfield_id` to make it a working field. Unlike Move Building this **commits directly**
(too many cross-table rows — zones/maps/furniture/generators/power_zones/npcs — for zone staging),
mirroring `apiBuildApartmentBlock`; export + push via CODEX to ship.

### Region power plant (region-scoped city plant)

Building a **⚡ Power Plant** (a `power`-type building) stands up power for the region it sits in:
after the normal build, `apiBuildBuilding` calls `installRegionPlant({regionId, zoneId: facadeId})`
in [environment.js:2530](../server/engine/environment.js). (There is no standalone toolbar button — region
power is done purely by placing a power building, so the substation *is* the plant.) Unlike the generic
`installGenerator` city_plant path — which re-points **every** outdoor tile map-wide to the new plant
(last-installed steals the whole grid) — `installRegionPlant` writes `city_grid` `power_zones` rows for
**only** the tiles carrying `flags.region_id = regionId`, and re-points the region's building junction
boxes to it (utility room → parent facade → `region_id`). Deterministic id `gen_region_<regionId>`
(idempotent re-run). Hosts the plant on the power building's facade (or, if called without a host, a
`building_type='power'` facade in the region, else the region-centroid tile). Direct commit; exportable
content (generators/power_zones are `class:'content'`). This is the only region-aware power tool — the
rest of the power model (city plant → junction box → interior) is otherwise global; see the power panel
for the per-tile installer and Auto-Resolve.

## Runtime consumption

- **2D minimap** ([minimap.js](../client/game/js/panels/minimap.js)) — paints
  `node.spec.fill` / `node.spec.text` and nothing else. Textured types still get
  `.mm-<terrain>`/`.map-<terrain>` classes from `spec.minimap_class`; the CSS
  textures (water/grass/dock plank) live in
  [styles.css](../client/game/styles.css) (`.mm-dock` ~`:2816`).
  The `authored_bg_wins` palette flag is what keeps water and grass preferring a
  tile's own `bg_color` — a legacy exception, now written down once instead of
  branched on in three renderers.
- **Tablet map** ([tablet-os.js](../client/game/js/panels/tablet-os.js)) — same
  `spec` + `terr-<type>` tile classes.
- **Pacing** — reads `spec.speed_mult`. This used to key off `flags.icon` matching
  `/^road_/`, so a tile *painted* `road` with no authored icon moved you at walking
  pace — 55 of the world's 158 road tiles. Runways and arteries keep their own
  clause in [pacing](../plugins/pacing/index.js): neither is a terrain. Not passability.
- **Flight** — `flags.terrain` **does** drive the aerial ground tint.
  `districtBiome()` ([biomes.js:55](../plugins/flight/biomes.js)) checks
  `TERRAIN_BIOME[flags.terrain]` **first**, before any id-prefix/danger inference — so an authored
  terrain wins the flight biome. The map: `water→water`, `dock→pier`, `grass→parkland`, `park→park`, `forest→forest`,
  `asphalt→asphalt`, `concrete→concrete`, `dirt/sand/gravel/marsh→badlands`, `scrub→scrub`,
  `redrock→redrock`, `ash→ash`, `hardpan→hardpan`, `alkali→alkali`, `cliff→cliff`, `plateau→plateau`, `ramp→plateau`. (`road` and `dirt_road` are intentionally absent — they're drawn by
  the road channel from `flags.icon`/`artery`, not the biome.) See
  [reference/world-rendering.md](reference/world-rendering.md).
  - **The open flight sim flies a baked snapshot, not the live world.** `client/game/flightsim.html`
    fetches a static `client/game/flightsim-world.json` (one cell per tile, no server/DB at fly time),
    so painted+published terrain does **not** appear there until the snapshot is re-baked. Re-bake
    from the dev panel: **Maps → Terrain palette → ⟳ Re-bake flight sim** (`POST /maps/flight-snapshot`,
    derives from the live in-memory world — publishes `reloadZone()` into it, so it's current). Or from
    the CLI: `node scripts/snapshot-flight-world.mjs` (local) / `node --env-file=.env.prod
    scripts/snapshot-flight-world.mjs` (prod). Both share one builder,
    [plugins/flight/snapshot.js](../plugins/flight/snapshot.js), so they can't drift. The JSON is a
    checked-in asset — **commit it** alongside the terrain change. The **live in-game cockpit** flight,
    by contrast, reads terrain live and needs no re-bake.
