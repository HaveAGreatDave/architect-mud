# The wildlands: the ground between regions

**Status: built** (2026-09-27). The shared function, the bake, the flight/cab floor (2-D and GL), the highway verges, the walked void rooms and the World Map app all read it.

## What it is

Every point on the surface that is not a placed tile is wildlands. Before this, four things each guessed what that ground was:

- the flight/cab floor, from the 73 tiles in its window (`fillOffMap`, with a hardcoded `BAY_SHORE_Y`), so the coast came out as a wedge;
- the highway verge, a dice roll every 18 tiles (`terrainAt` in `plugins/trucking/corridor.js`), which read as stripes from the air;
- the walked void, another dice roll per room (`mkRoom` in `plugins/voidwalking/index.js`);
- nothing at all for a map.

Now `wildlandsAt(x, y)` in `client/shared/wildlands.js` answers for all of them. It is a pure function of the world tile plus a baked field, so the server, every client and every seat agree about it.

## The pieces

| File | Role |
|---|---|
| `content/map/wildlands.json` | Authoring: each region's halo (`biome`, `reach`), the coast, how far each edge terrain carries on past a region's rim (`edge`), and the landforms (Mount Cinder). |
| `content/map/routes.json` | Route numbers for the highways, keyed by the two regions a road joins. |
| `scripts/content/bake-wildlands.mjs` | Reads those plus the placed `map_world` tiles and writes `client/shared/wildlands-field.js`: distance to land, to the bay, to each region, and the terrain of the nearest region edge, on a 4-tile grid. `npm run wildlands:bake`; `--check` fails if stale. |
| `client/shared/wildlands.js` | The rules. `wildlandsAt`, `wildlandsColour`, `landformHeight`, `routeNumber`. |
| `client/shared/ground-palette.js` | `BIOME_GROUND`, moved out of `windshield.js` so the map and the floor share one palette. Adds `scarlet` and `lava`. |
| `client/shared/worldmap-render.js` | The map canvas, for the tablet app and anything else that wants it. |
| `plugins/worldmap/` | The World Map tablet app and the `worldmap` verb. |

`content/map/` is a non-table folder (`NON_TABLE_DIRS` in `scripts/content/lib.mjs`): the DB import skips it and only tooling reads it.

## The rules, in order

1. **Sea.** North of the coast line (the coast region's north edge plus `coast.offset`, wobbled) or the bay running out north of itself. The coast runs the whole width of the map.
2. **Region edge carries on.** Within `edge[terrain]` tiles of a region, the terrain at the nearest edge tile continues, with a sharp, noise-warped boundary. A cliff line becomes plateau with a cliff rim, so a mesa that meets a region border finishes rather than being cut off.
3. **Base country.** Dirt at the edge of the built world, going over to rust mesa further out (`wildMix`, unchanged from the old floor).
4. **Halos.** Each region's `halo.biome` spreads out over `halo.reach` tiles, noise-warped, weights normalised so two halos that meet mix.
5. **Landforms.** Ash fall along a volcano's plume, then the cone: basalt high up, ash on its lower slopes, lava in the crater and in live flows.

The answer carries a `blend` (biome weights, for colour) and a `terrain` (a real terrain key, for tiles and prose).

## Rules worth knowing

⚠ **Render and prose only. Never `surfaceAt`, never collision.** "No placed tile here" is how `regionGates` and voidwalking find the edge of the world. Mount Cinder is in the hillshade (`reliefShade` via `landformHeight`) and cannot be flown into.

⚠ **A verge is flat.** The highway maps `cliff`/`plateau` to `redrock` and `water` to `sand` (`ROAD_TERRAIN`), so a region's cliff line carrying on past its rim cannot raise a massif on the shoulder. Void rooms map `cliff` to `plateau` (`WALK_TERRAIN`), because `cliff` is the one impassable terrain.

⚠ **The legacy local-frame road keeps its roll.** An unanchored corridor has no real coordinates, so `terrainAt` only reads the wildlands when `route.anchored`; every pinned regress road is unchanged.

⚠ **Void rooms still draw the roll** before overriding it, so the RNG stream under the name and description does not move.

⚠ **The GL floor samples a texture, not the function.** `wildTexture()` in `windshield.js` builds a 2-tile-per-texel RGBA image once (rgb colour, a = sea) and `gl/floor.js` samples it on unit 7 past the map window. The waterness it gives overrides the clamped boundary tile's guess, which is what makes the far coast run the right way.

⚠ **Move a region, re-bake.** The field is derived from placed tiles. `gl:wildlands` (in `pretest:regress` and `shapes:smoke`) fails if it is stale.

## The World Map

Tablet app `worldmap` and verb `worldmap`. The server sends the placed tiles (one character per tile, by biome) and this week's road polylines with route numbers; the client draws the wildlands itself from the shared field, so there is no egress for it and the map cannot disagree with the ground. The tablet imports the renderer lazily, so the 172 KB field is only fetched by someone who opens the app. Everything is visible (no fog of war). The verb prints a character map and the route list, so it reaches the log at every Display Mode rung.

The dev copy at `tools/worldmap/` (`node scripts/map/world-map-dump.mjs`, then open it served from the repo root) adds hover detail for every placed tile.

## Gate

`node scripts/shapes/wildlands.mjs` (`npm run gl:wildlands`): the field is fresh; every biome is in the palette and every terrain is real; the sea runs the whole way along the coast; each region's halo biome is what you find just outside it; each cone falls away from its crater; the function is pure.

## The road network

**The connections are content** (`content/map/voids.json`), baked into the field and read by `VOIDS` in `plugins/voidwalking/index.js`. They used to be a literal in that file, which put Architect's map inside an engine plugin. The shape and the keys are unchanged, because a destination `key` is the seed of its road: change one and that highway re-rolls.

**The network, as built (2026-09-27):** Coldwater is the hub, and no two highways run side by side into one place.

| Route | Road | Type |
|---|---|---|
| 1 | Coldwater → the Scarletwastes → Terminus | trunk (the spine) |
| 2 | Coldwater → the Reach | branch |
| 3 | Coldwater → Deadwater | branch |
| 4 | the Reach → the Scarletwastes | branch, leaves on Route 2 and merges into Route 1 |
| 5 | the Reach → Deadwater | branch, merges into Route 3 |

One road leaves the Curtain's one gate and runs 24 tiles south (`hub` in voids.json, signed 1/2/3), where it splits three ways as a Y. Routes 4 and 5 are the Reach's roads; each joins a Coldwater road partway along and shares it into the destination (signed 1/4 and 3/5). A number may cover legs that chain through regions, which is how Route 1 is one route across two crossings.

**Sharing is built, not authored.** A road into an entrance that a hub road already reaches is built by `mergeInto` (join the hub road at the far end) or `cutOff` (leave on one hub road, cross, join another), whichever lays the least road of its own; a join is built backwards from the far road so it is tangent there, and is kept only within `MERGE_MAX` (45°) and when the whole road is at most `MERGE_DETOUR` (1.5×) the gap between the entrances. Otherwise a road is built on its own.

**Route numbers and types are content** (`content/map/routes.json`): `routes` maps a region pair to `{ number, type }`, and `types` defines each highway type (`half`-width in tiles, `lanes` 1–6, `dirt`, `label`, `shield`). `client/shared/highways.js` is the one reader, shared by the server and the map.

- **trunk**: the spine. Wider (6 lanes), old tarmac.
- **branch**: an ordinary highway (4 lanes), old tarmac.
- **ramp**: a one-lane slip road, used only by a hub.
- **spur**: a short dead end. Unused so far.

**Every road carries typed segments.** `networkRoute` tags the pieces it joins, `joinRoutes` records them as `segments: [{ s0, L, type, seedKey, nums }]`, and `reverseRoute`/`sliceRoute` keep them. `pavedAt` and `lanesAt` read the type (eased across a change of type, still tapered where the road meets the map), and `corridorAt` ships `road_type`, `road_lanes` and `road_dirt` from it, so the truck and the plane see the type with no renderer change. ⚠ **A road with no typed segments is LEGACY** (0.95 half-width, four lanes, dirt), never the content `branch`: hand-made and unanchored roads must keep the look they shipped with.

**Boards.** A road's boards go up after its sibling branches are built, so a gate or fork board names every road leaving that fork. A MERGE board stands just past each point where another route comes in (the road's numbers change), and passing it prints a line saying so. A merged road's trunk is the shared stretch it starts on, never its whole first piece, or its fork board lands in the wrong place.

**Every piece carries its route numbers** (`tagNumbers`), which the boards (`passSign` prints "ROUTE 1 · OLD TRUNK ROAD"), the `route` command ("Route 1", with the real road length rather than the gate gap) and the map all read.

**Road condition** (`conditionAt` in corridor.js, shipped as `road_cond` 0–1): a slow drift keyed to the MAP POSITION of the tarmac, so a stretch is good or bad for tens of tiles at a time and a stretch two routes share is in one state whichever route you drive it on (keyed to the journey it was three states at once). The windscreen draws three states of worn tarmac. **Good** is plain tarmac with the paint still readable. **Worn** has patches, cracks, faded paint and sand at the edges. **Broken** has potholes in the wheel tracks, slabs gone to gravel, heavy drift and no paint. ⚠ **It is a 3-D effect only**; the map does not draw it. A road that never ships `road_cond` gets the middle state, which is exactly the one worn look it always had, so the city's streets are unchanged.

## Regions with more than one entrance

**An entrance is found, not authored.** `regionGates` (plugins/trucking/state.js) takes every road tile on a region's rim and makes each separate clump an entrance, and `gatePair` gives each highway the closest pair of entrances. So a second entrance is only a road painted to the region's edge. The Scarletwastes has two, at 1000,957 and 1092,957, joined by one straight road along row 957 (it cuts through a mesa at x 1011–1017, which is deliberate).

**Each entrance offers only its own roads.** `destsFromGate` keeps the destinations whose road leaves from the entrance nearest a point. It is registered into voidwalking (`registerGateFilter`, because trucking imports voidwalking and not the reverse), so a walker stepping off the west edge of the Scarletwastes is offered the Reach, and off the east edge only Terminus. The same filter picks a truck's pre-departure preview road, and each interchange only groups the roads leaving from its own entrance.

⚠ **A fork turns a different way for each road.** The walker's fork gives each destination one compass exit (`dir`), so a region offers at most as many roads as it has directions. `gl:wildlands` fails on a repeated `dir`, a one-way connection, an unnumbered pair, or a route naming a type that does not exist.

⚠ **Edit a road tile, then `npm run content:import`.** The world loads from the database, so gates computed from the files and the running world can disagree until the import runs.

## Hubs and slip roads

A region's `voids.json` entry may carry `hub: { toward, distance, ramps }`. `toward` is a compass word or a bearing in degrees. Every road out of the gate shares one trunk that far that way. With `ramps: false` (Coldwater) it forks as a Y: every road carries on from the end of the trunk, starting on the trunk's heading (`corridorFor`'s `anchor.h0`) and turning in on an arc of 1.15 × the fold radius, then holding its line. Otherwise the road that carries straight on continues, and the rest leave 18 tiles earlier on one-lane slip roads. A destination may also pin the entrance its road uses (`gate`), which is how the Reach's three roads all leave by one entrance.

⚠ **The minimum turn radius is about 43 tiles** (1.8 × the 24-tile verge band), and no seam in a built road may turn more than 40°. `plugins/trucking/regress.js` measures the seam on every road, which is the real invariant. A hub only makes sense where the destinations lie roughly the way the trunk runs.

## Footpaths

The World Map draws the walkers' trail beside each road (`trailFor`, the same trail the walked crossing is laid on), with its camps, as a thin dotted line far narrower than any road.
