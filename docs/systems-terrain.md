# Terrain & the Terrain Painter (as built)

Terrain is the **ground surface** of a zone tile (road, concrete, grass, water,
dock…). It is authored per-zone in `flags.terrain` (a single string) and painted
through a dev-panel Maps mode. Terrain blocks a step in **exactly two** cases: `cliff`, whose
`props.passable` is false, and `scree`, which is impassable too but carries `props.climbable` and opens
for somebody with the gear ([High ground](#high-ground-cliff--plateau--ramp-2026-08-12)). Everything
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
| `scree` | `#8a5a3e` | **no**, but *climbable* | the broken face somebody equipped goes up ([2026-08-21](#scree-the-fourth-height-terrain-2026-08-21)) |

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
  **A climb now exists, and the rule it had to survive is intact** — see
  [`scree`](#scree-the-fourth-height-terrain-2026-08-21). The sentence that stood here read: *"No climb
  and no gear exemption, deliberately — a wall you can sometimes get over is a difficulty check, not a
  funnel, and the value of the feature is that the ways through are legible."* Every clause of that is
  still enforced. What changed is that the exemption is a property of the **tile** — a painted, visible
  one — rather than of the gear, and that passage is deterministic, so no wall is ever one you
  *sometimes* get over. A bare `cliff` remains absolutely impassable to everything but wings.
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
  are on its outline. Five things make it read as terrain rather than as crates — see below.
  Rendering only: **CFIT reads building mass, not terrain**, so a pilot may still fly through a mesa.

### The corner lattice, and why a massif stopped looking extruded

The first massif was an extruded stamp: **one height per tile, a flat quad cap, four axis-aligned
walls dropped straight to the ground**. From the air that is a stack of crates. The top is a
dead-level plane cut into visible squares by the per-tile tone jitter, the outline is the tile grid
with 90° corners nothing in geology makes, and every face is one unbroken plane from rim to floor.

Everything about the shape now comes from **three functions of a world coordinate**, and that choice
is load-bearing rather than stylistic: two tiles have to agree about the edge they share without
either being told the other exists, and a shared corner is one call with one answer, so the mesh is
watertight for free. Anything derived from the *tile* instead — a seed, an index — puts the grid
back the instant it reaches a colour or a position, which is exactly what the old tone jitter did.

- **`cliffHeightAt(wx, wy)`** — four octaves (0.36–0.70 world-z). The low pair make one tableland
  differ from the next and give a long escarpment a rise and fall along its length; the high pair are
  the local roughness that stops a rim running flat to the horizon. Worst neighbour step is ~7% of a
  full cliff, so the top undulates instead of jittering into a staircase.
- **`cliffCorner(cx, cy)`** — the same lattice corner, **displaced up to a quarter-tile in x and y**.
  This is what takes the right angles out of the plan view. Kept under half a tile deliberately: a
  larger warp can march one corner past another and fold the tile's cap into a bow-tie.
- **the mottle** — tone, flare depth and gully placement are all sampled from world position at a
  frequency *finer than a tile*, so variation reads as rock instead of as tile-sized patches.

On top of that lattice:

1. **Full tile width, no setback.** `draw3DBoxAt`'s ±0.44 clamp is right for buildings and wrong for
   ground: at ±0.44 adjacent tiles show a lit seam between them and the massif reads as crates.
2. **A wall only where the high ground stops** — the complement of `cf`. A continuing side now needs
   no *step* face either (see below).
3. **The top is a fan, not a quad.** The cap is triangulated from the tile centre out to a ring of
   corner and edge-midpoint samples, each at its own height, each shaded off **its own normal**
   against the sun key the Mode-7 floor hillshades with. A flat quad at one height has exactly one
   tone, and forty of those side by side is a painted plane.
4. **A face has a foot.** The wall is two bands: a near-vertical caprock face down to a bench at 0.42
   of the height, then a **talus apron battered outward** to the plain in a lighter, greyer,
   broken-rock tone. A single vertical plane from rim to ground is the loudest single tell of an
   extrusion, and the apron is also what puts an uneven silhouette where the massif meets the floor
   instead of a ruled line. Corner points flare along the **diagonal** where two open sides meet, so
   a convex corner closes instead of opening a wedge.
5. **Strata at constant world z**, not at a fraction of this tile's height — with an undulating rim,
   fractions make the beds step at every tile boundary instead of running through the massif as one
   cut. A bed above the local rim clamps to it, which is what a truncated bed looks like anyway.

6. **⚠ The shell is never backface-culled, and terrain is the only mass in the file that isn't.**
   A cull is free and correct for a box you can only ever stand outside of. **Nothing collides with
   terrain** — a truck drives into a mesa, an aircraft flies through one — and from in there the
   *whole* outline faces away, near rim as much as far, so the cull removed every wall at once. The
   massif became a slab hanging in the air over open desert, open to the horizon on all four sides,
   with one stray panel surviving where a notch happened to point back at the camera. So the outline
   is drawn whole and the facing test only picks the **shading**: outside is lit rock, inside is
   unlit rock, and strata, gullies and the rim line — all statements about a face seen from outside
   — are skipped on the inside. Painter order needs nothing new, because a far wall genuinely is
   farther (the talus flare pushes its foot farther still) and sorts behind what covers it.
   Correspondingly, **a cap above the eye is a ceiling, not a top** (`cam.EH` is the eye's world-z,
   the same unit as the cap's): sunlit caprock painted at you from its own underside is the one
   lighting a solid rock ceiling cannot have.

Two consequences worth knowing before touching any of it:

- **The step face is gone, and its absence is the proof the lattice works.** The old per-tile height
  left an open sliver wherever high ground continued but this tile was the taller of the two, and a
  short step face was drawn to close it. Corner heights are shared, so there is nothing to close.
- **`drawCliffMass` depth-sorts its own faces** rather than leaning on `emitFace`. `flushFaces` nulls
  `FACE_SINK` before running a queued closure, so every `emitFace` made from inside a mass draw
  paints immediately, in call order — a massif is the first mass in the file with enough internal
  faces for that order to matter. Faces also **fog** now, so a distant mesa hazes into the plain
  instead of staying saturated in front of it, and a **distance LOD past 22 tiles** drops the ring
  midpoints and the strata/gully detail (halving the face count) where they are sub-pixel anyway.
- **`cliffLatticeSmoke()` is the gate on all of this** (`shapes:smoke`). It asserts the two things
  that never fail loudly — a shared corner is one point at one height, and a lone stack keeps all
  sixteen of its wall bands from outside and does not vanish from a camera inside its own footprint.
  Both produce a picture; just the wrong one.
- **cliff and plateau are one landform lit two ways, and the SURFACE picks the tone, not the tile.**
  Every top takes the caprock colour and every face the rim colour, with the tile's own biome mixed a
  third of the way in. Before this a mesa made of `cliff` tiles had a top as dark as its own shadowed
  north face.

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

## `scree`: the fourth height terrain (2026-08-21)

`ramp` is the way through a rim for anybody. **`scree` is the way up a rim for somebody equipped** — a
broken, loose face with a line on it. It is impassable like a cliff (`passable: false`) and carries one
more property, `climbable`, which nothing but the impassable-terrain law reads.

**Why the no-gear-exemption rule did not have to be broken to add it.** Read that rule again and the
objection is to *"sometimes"* and to *"you cannot see it coming"* — not to rope. Both survive:

- **Bare `cliff` never carries `climbable` and must never be given it.** It stays absolutely impassable
  to everything but mutation flight, exactly as before, and nothing purchasable opens one. The climbing
  plugin's regress asserts this **with the gear in hand**, because it is the invariant every funnel and
  every wall in the world rests on.
- **A scree tile is PAINTED.** Its own terrain, its own fill, its own name on the map. "A player can look
  at the map and KNOW where the ways through are" is unchanged; there is one more kind of way through and
  it is drawn. Same `auto_tile_family: "cliff"`, so a notch of scree in a run of cliff reads as one
  escarpment with a paler seam in it rather than as a gap in the wall.
- **Passage is deterministic.** Gear and stamina decide it, never a roll. The Climbing skill scales the
  *cost*, the way Swimming scales a stroke.

⚠ **Never paint scree where a cliff is doing structural work.** A cliff that seals a town, a quarantine
or the far side of a quest is a funnel somebody built, and a scree tile through it is a back door with no
lock on it. Paint scree where the map intends a hard way round.

**What it opened.** ~737 tiles were reachable only with wings: **707 in Terminus** (one pocket of 640 —
the entire southern and eastern outside of that region, more than half its walkable ground), **21 in
Deadwater** across three mesas, **9 in the Scarletwastes**. **Twelve** scree tiles opened all of them,
and cost twelve terrain values and *no wiring at all* — the cliff tiles already carried reciprocal exits
with their neighbours, which is exactly the property "the graph stays true" was protecting. The one tile
still unreachable on foot afterwards is `zone_echelon_exterior`, the flying base, which is correct.

Each route is named for what it is rather than taking the region's generic tile name — The Notch, The
Broken Stair, Handholds, The Seam, Cutback, The Clinker Stair, The Cooled Gully, The Ropes, Talus Fan,
The Scramble, Split Rock, The Chimney. That is not decoration: the cliff boilerplate these tiles used to
carry says *"There is no way up here. There is a way up somewhere, and this is not it."* The world was
written expecting passes, and a player who reads that line on nine tiles and something different on the
tenth has been told where to climb without a quest marker.

The mechanic lives in [plugins/climbing](../plugins/climbing/README.md); this doc owns the terrain.
