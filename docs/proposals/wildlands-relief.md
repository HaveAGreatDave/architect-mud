# Wildlands relief: one carved field for the ground between regions

**Status: phases 1–4 built; phases 5–8 are design** (2026-10-26). The relief is baked and shipped, the World Map draws it, the anchored highways follow its valleys past massifs raised from it and stacked by tier, and the flight floor shades from it; see [the relief, as built](../systems-wildlands-ground.md#the-relief). The decisions are taken (see [Decisions](#decisions)). Read [systems-wildlands-ground.md](../systems-wildlands-ground.md) and the high-ground section of [systems-terrain.md](../systems-terrain.md#high-ground-cliff--plateau--ramp-2026-08-12) first.

## What we want

- Roads that bend round cliffs. A cliff never runs through a road.
- Cliffs in stepped layers, cut by water: canyons with benches, mesas and buttes left standing between the drainages.
- Flat grassland that moves in the wind.
- Dust and tumbleweeds in the red rock.
- Gentle rolling hills between all of that, as real raised ground.
- Terrain that does something. A walker can't climb a cliff, a truck can't drive through one, a pilot who flies into one crashes, and the way through is a pass you can see.

## Why it doesn't happen today

Four things invent the wild terrain, and none of them reads the others.

| Source | File | What it makes | Who sees it |
|---|---|---|---|
| `landformsFor` | `plugins/trucking/corridor.js` | Seeded discs, 30 to 70 tiles across, that the road builder steers round (`avoidTurn`) | Nobody. The discs are never drawn |
| `highTerrainAt` | `client/shared/landform.js` | An fbm threshold that turns verge cells into `cliff`/`plateau` | The cab and plane, as real massifs |
| `wildsRelief` + `groundElev` | `windshield.js`, copied in `gl/floor.js` | Terraces and ridges in the hillshade | The floor, as shading only |
| `wildlandsAt` | `client/shared/wildlands.js` | Biome blend, region edges carrying on, Mount Cinder | Floor colour, verge terrain, void rooms, World Map |

So the road swerves round a mesa nobody can see, then drives into one it never knew about. `HIGH_OFF` clears everything within 7 tiles of the centreline, which cuts a slot through the massif. That slot is the "cliff running through a road". The hillshade draws a third set of terraces that match neither. Height is one tier everywhere (`cliffHeightAt`, 0.36 to 0.70), so nothing can step twice, and the floor itself is the plane z = 0.

Nothing carves anything either. Every shape is noise thresholded at a level, and noise doesn't know which way water runs.

## The idea

Bake one relief field offline, the way the wildlands field is baked now. Carve it with simulated erosion so the shapes come from water. Then make every reader use it: the road builder routes on it, the corridor places massifs from it, the floor draws its height, the vehicles ride on it, the void rooms describe it, and the World Map draws it.

```
content/map/wildlands.json   provinces, strata, climate     (content: the numbers)
          │
scripts/content/bake-wildlands.mjs
  uplift → strata → erode (stream power + creep) → tiers → flow → biome
          │
client/shared/wildlands-field.js   + height, flow, tier planes (2-tile cells)
          │
client/shared/wildlands.js   reliefAt(x, y), groundZ(x, y)  ← the only readers of the planes
          │
  road router · corridor massifs · floor · vehicles · void rooms · World Map · life
```

This keeps the rule that already holds: **the relief is never `surfaceAt`**. "No placed tile here" is still how `regionGates` and voidwalking find the edge of the world. Collision, grade and passability read `reliefAt` and `groundZ` through named laws, never by turning relief into placed tiles.

## The bake

### 1. Provinces and uplift (content)

`wildlands.json` gets a `provinces` list. Each one is a region id or a polygon with an uplift, a rock type and a moisture value. For example: the Scarletwastes high country lifted and layered; the coastal plain by Coldwater low, soft and wet; the Deadwater basin low and dry; the Reach's scrub as broken middle ground. Mount Cinder's cone joins the height here instead of living only in the hillshade.

Starting height is uplift plus slow fbm, so a province has hills inside it.

### 2. Strata (content)

A list of beds by elevation, each with a hardness: a hard caprock, soft shale under it, another hard band, and so on. This is what makes multi-layer cliffs. Hard beds hold a near-vertical face; soft beds weather back into a slope. A canyon cut through three hard beds comes out with three cliff bands and two benches between them, without anyone drawing them.

### 3. Erosion

On a 2-tile grid (about 327 × 173 cells over today's rect):

1. Fill pits with a priority flood so every cell drains somewhere.
2. Route flow downhill (D8) and accumulate drainage area.
3. Cut each cell by stream power, scaled by drainage and slope and divided by the hardness of the bed it's in.
4. Let soft ground creep (hillslope diffusion); hard beds barely creep.
5. Repeat a few hundred times.

Base level is the sea in the north. Region rims are pinned to ground level (or to their painted cliff where `edge` says the rim is a cliff), so the carved country always meets a placed region cleanly.

Out of this come canyons that branch the way drainages do, mesas and buttes where two drainages haven't met yet, washes on the flats, and benches where a hard bed outcrops. That's the "realistically carved by water". The washes are dry: water carved them, but none runs in them now.

⚠ **The bake has to be byte-stable**, because `--check` compares it and every developer's machine runs that check. Use only `+ - * /` and `Math.sqrt` in the loop (no `Math.pow` or `Math.exp`, whose last bit can differ between V8 versions), iterate in a fixed order and quantise before writing.

### 4. Tiers

Height is quantised to tiers at the strata boundaries. A tile where the tier steps up and the slope is steep is `cliff`; a step at a gentle slope is `ramp`; a steep soft step is `scree` (climbable with gear, which already exists). Tier edges are found per tile by sampling the 2-tile height bilinearly with a small noise warp, so rims are sharp at tile scale while the stored plane stays small.

### 5. What it writes

Three new planes at 2-tile cells: height (u8), log flow (u8), tier and hardness packed (u8). About 170 KB raw, roughly doubling `wildlands-field.js`. Height may need 16 bits for smooth slopes under a ray-march; test u8 first and widen only if the hills step. It's a static file, cached, and the World Map already loads it lazily; check the cost against [ops-usage-watch.md](../ops-usage-watch.md) before shipping. If the size hurts, deflate the planes and inflate them with `DecompressionStream`.

## Biomes from the relief

`wildlandsAt` keeps its sea, region edges and halos, but its base country stops being a dirt-to-redrock noise blend. Ordered rules in content pick a biome from height, slope, flow, moisture and province:

| Where | Biome | Feel |
|---|---|---|
| High flow, low slope | `wash` (new) | Dry sand and gravel bed, deadwood, the odd pool after rain |
| Low, wet, flat | `prairie` (new) | Long grass that moves |
| Low to middle, gentle slope | `scrub` / `badlands` | The rolling hills |
| Tier tops in dry provinces | `redrock` / `scarlet` | Hoodoos, tumbleweeds, dust |
| Foot of a cliff | `scree` | Talus, climbable |
| Old lakebed | `hardpan` / `alkali` | Flat and cracked |
| Mount Cinder | unchanged | Basalt, ash, lava |

Grass falls out of the rules: the coastal plain round Coldwater and the floors of the big drainages, wherever it's low, flat and wet. There's no prairie province of its own. Halos still blend toward each region at its rim. The regions themselves are untouched: the Scarletwastes stays uniformly `redrock` on purpose.

## Roads that go round

Roads are built at runtime from `voids.json` and the seeds in `corridor.js`, and they stay that way. What changes is how they choose a line.

1. **Route first.** For an anchored road, run A* on the 2-tile grid from gate to gate. Cost is grade squared, plus a large cost for a tier change, plus a smaller cost for crossing a wash, and a cliff is impassable. A road crosses a wash in a dip (a floodway), not on a bridge, since the washes are dry.
2. **Then build.** The existing arc-and-straight builder follows that path by aiming at a point some way ahead on it, instead of straight at the target. `MIN_RADIUS`, the 40° seam limit and the fold invariant are unchanged; regress already measures them on every road.
3. **Cuts where it must.** If the only route crosses a tier, the road gets a **cutting**: the ground is lowered to the road's profile inside its easement, with short cut walls drawn both sides and `ramp` underfoot. That reads as engineering, not as a cliff with a slot in it. It's the same cut-and-fill rule as on the hills (see [Roads on hills](#roads-on-hills)), taken to its extreme.
4. **`landformsFor` and `avoidTurn` go.** The road steers round the real thing now.

The walker trail is laid off the same path, so a walker's shortcut is a real pass or a real wash.

**This re-rolls every anchored road, once.** Lengths change, so trucking pay, plaza and sign positions and the World Map polylines all move. Unanchored legacy roads (every pinned regress road) don't change, the same as today.

## Massifs in layers

`drawCliffMass` caps a `hi` tile from 0 to `cliffHeightAt`. It needs a base as well as a top: a tier-2 tile draws from the tier-1 ground up, not from the plain. The flight cell gains a tier (next to `hi` and `cf`), and `cf` is computed per tier so a bench between two cliff bands is a top for one and a foot for the next. The bench-and-talus face, strata at constant world z and the corner lattice all carry over unchanged. The strata lines finally match real beds, because they come from the same table.

With real height (below), a massif's base is `groundZ` at the foot of the face and its top is the upper tier's ground, so the floor and the face meet with no gap.

The corridor's `highTerrainAt` call becomes `reliefAt(x, y).tier`. `HIGH_OFF` stays as a safety margin but should almost never fire, and a gate counts how often it does.

## Real ground height

The near ground is raised for real, not just shaded.

### One function

`groundZ(x, y)` in `client/shared/wildlands.js`, read from the baked height plane. It's 0 inside every region, it eases to 0 across the last `rimEase` tiles before a rim, and it's 0 at the coast, so the city, the airfields and the sea don't move. Everything that stands on the wild ground reads it, and nothing keeps its own copy. The server and the client import the same module, so they agree to the bit.

Height has two parts:

- the **gentle part**: hills, swells, the slope down into a wash. The floor draws it.
- the **steps**: each tier's rise. The massifs draw them. The floor under a cliff tile stays at the lower level, and the face covers the step.

### The floor

The GL floor is one screen-filling triangle. Each pixel's ray hits the plane z = 0, and the depth is worked out from that (`gl_FragDepth` in `gl/floor.js`). With height, the ray marches through a height texture instead: a few coarse steps, then a short binary refine. Every material term after the hit is unchanged, because they all key on the hit point. The hillshade gets a real normal from the texture, and `heightFog` gets the hit's real z instead of 0. Gentle slopes keep the march short.

If the march costs too much on the cab frame, the fallback is a clipmap mesh round the camera, shaded by the same fragment code. Measure both on the `__glFloor()` scenes before choosing; today the floor is 1.3 ms on a city cab frame, and the budget for the march should be stated before it's written.

GLASS 1's software floor stays flat with hillshade. GLASS 2 is the path that matters, and the DOM-stub gates keep testing the flat raster. `RENDER_TUNE.groundZ = 0` turns height off everywhere at once, as the escape hatch and for phones if they need it.

### What stands on it

Each of these reads `groundZ` at its base:

- road ribbons: each vertex at the road's profile height;
- scatter billboards, hoodoos, tumbleweeds, grass clumps;
- roadside sheds, wrecks, boards and plazas, with a plaza's pad levelled;
- massifs, based at the lower tier;
- shadows, cast onto the height rather than the plane;
- the truck: z from the road profile (or the ground off it), pitch and roll from the wheel contacts;
- the aircraft: height above ground is `alt - groundZ`, and the radar altimeter, ground-proximity warnings and touchdown all read that.

### Roads on hills

A road can't follow every bump. Along each built road the **profile** is the ground height smoothed along the centreline and clamped to a maximum grade. Inside the road's easement the ground blends to that profile: cut where the hill is higher, fill where it's lower. So the tarmac never floats or sinks, and a hill the road passes through shows a cut bank. A cutting through a tier is this same rule at its extreme.

The server builds the roads, so it ships the profile height with each vertex in `roads.near`, and the client's `groundZ` blends to it inside the easement. A stretch two roads share has one profile, computed once for the shared segment, the same way road condition is keyed to map position.

### Grade does something

Trucks lose speed up a grade and gain it going down, scaled by load. The rig already sells a Jake brake to hold a loaded grade; now there's a grade to hold. The server still derives the odometer from 2-D position, which doesn't change.

## Life

All of it is a pure function of world position, the wall clock and the weather field's wind (`wxField.wind.dir`/`kph`, already on the client), the way birds are. No server state and no egress. Everything stands at `groundZ`.

- **Grass.** From the air: a travelling brightness band on `prairie` texels in the floor shader, running downwind with gusts, which is how wind over grass reads from height. Up close: instanced grass clumps in the near ring with a vertex sway on the same gust field. Phones get the floor wave only.
- **Tumbleweeds.** Rolling actors on lanes seeded per 64-tile cell in `redrock`, `scrub` and `hardpan`. They roll and bounce downwind when the wind is up, follow the slope, pile against a cliff foot (they read the tier) and stay put on a still day. The static tumbleweed billboard stays as the one that's stopped.
- **Dust.** Low drifting dust sheets along the wind on dry ground, and dust devils on hot, dry, windy afternoons in the red rock, keyed to the weather field's temperature and dryness.
- **Sound (optional).** A SIREN wind bed that rustles over grass and whistles over rock.

## Text: the walker's side

This is a MUD, so a walker has to get all of this in prose.

- `reliefAt` answers more than a terrain: tier, slope, the nearest rim and which way it lies, whether this is a wash, a bench or a pass.
- Void rooms describe it: the dry wash bending east under two shelves of banded rock, the pass ahead, grass to the horizon, the road dropping through a floodway. Pools are written to [house-voice.md](../reference/house-voice.md) and kept short.
- Exits that cross a cliff are refused through the existing `engine:impassable-terrain` law, and scree opens for climbing gear the same way it does on the placed map. `WALK_TERRAIN`'s `cliff → plateau` mapping goes, because the trail now always has a passable line.
- Ambient lines for tumbleweeds, dust and wind in the grass, so the log rung gets the life too.

## What makes it functional

| Who | Today | After |
|---|---|---|
| Walker | Never blocked (cliff mapped to plateau) | Blocked by cliffs, climbs scree with gear, finds passes and washes |
| Truck on the road | Flat road | Rides the profile; a grade costs speed going up and needs holding going down |
| Truck off the road | Drives through mesas | A cliff face is a wall in `collide.js`, the same as a building; it rides the hills |
| Aircraft | Flies through mesas over a flat floor | CFIT against cliff faces and the ground itself; height above ground reads `groundZ` |

CFIT is reported by the client's flight sim and settled by the server (`plugins/flight/index.js`), so the sim's sweep gains the relief: cliff faces as walls, and `groundZ` as the floor. Each reader goes through its own named law, and none of them through `surfaceAt`.

## Gates

`gl:wildlands` grows:

- the relief planes are fresh, and two bakes give the same bytes;
- no `cliff` tile within the road clearance on any built road, except a declared cutting, and a count of how often `HIGH_OFF` had to clear one;
- every road's profile stays under the grade limit, and the ground at the shoulder matches the profile;
- `groundZ` is 0 inside every region, at every region rim, at every airfield and at the coast;
- every pair of region gates is joined by a passable walking path through the relief;
- water drains downhill everywhere, to the sea or a closed basin;
- the field stays under a size budget.

`shapes:smoke` covers a two-tier and a three-tier massif standing on raised ground. Trucking's regress keeps measuring the seam and the radius on every road. The floor march can't run under the DOM stub (no WebGL), so it's checked in the browser on the `__glFloor()` scenes, with a JS twin of the march compared against `groundZ` at sample pixels.

## Phases

1. **Preview tool first.** Bake to PNG layers (height, tiers, flow, biome, routed roads with their profiles) and show them in `tools/worldmap/`, with a cross-section view, so we can tune provinces, strata and erosion by eye before anything reaches the game. Nothing ships.
2. **The relief bake, `reliefAt` and `groundZ`.** The World Map draws contours, washes and cliffs. No change in the 3-D world or in play.
3. **One field.** The corridor and the floor hillshade read the relief; layered massifs in `drawCliffMass`; `highTerrainAt`, `wildsRelief`'s terraces and `landformsFor` removed (legacy unanchored roads keep their roll).
4. **Roads route on it**, with profiles: A*, the path-following builder, cuttings, floodways, the walker trail. Anchored roads re-roll here.
5. **Real height in GLASS 2.** The floor march (or the clipmap), then everything that stands on the ground, the truck riding the profile and the aircraft's height above ground. Behind `RENDER_TUNE.groundZ`.
6. **Biomes from the relief**, and the void-room prose.
7. **Life:** grass, tumbleweeds, dust.
8. **Functional:** walker cliffs, truck walls and grade, CFIT against the relief.

Phases 1 and 2 are cheap and change nothing anyone can see in play, so they're where we find out whether the shapes are good. Phase 5 is the biggest and the riskiest, so it gets the floor benchmark before any of its other work starts.

## Decisions

Taken 2026-10-26.

1. **The roads re-roll** in phase 4. Every anchored highway's line and length changes once.
2. **Dry washes only.** No live rivers and no bridges; roads cross a wash in a floodway.
3. **Cliffs stop trucks off the road, and aircraft.** Both, through the trucks' wall collision and the flight sim's CFIT sweep.
4. **Real raised ground, in this work**, not hillshade alone and not a later proposal. Phase 5.
5. **Grass on the low wet ground**, from the biome rules. No separate prairie province.
