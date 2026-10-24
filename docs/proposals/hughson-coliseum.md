# The Charles B. Hughson Coliseum *(as built)*

**Status: BUILT, but for seats in person.** Deadball's ballpark, on the map and on TV: nine
tiles in Halcyon Fields, two gates, eleven rooms, one vendor, one GLASS arm over nine building types,
a map icon, a retractable roof that shuts for the weather, and field lights every night. It's an
art deco park from the Meridian's decade, kept up, under a roof added long after. Five ballpark
trades stand on the plots either side of it (§10). The buildings and the green it replaced, and the
five Halcyon buildings the trades replaced, are set aside on a holding map, not deleted. Built
2026-10-18 as Phase 6 of [deadball-glass2.md](deadball-glass2.md#phases), which called the park
Halcyon Field, and rebuilt in deco with the roof the same day.

The content is written by [scripts/content/hughson-coliseum.mjs](../../scripts/content/hughson-coliseum.mjs)
and [scripts/content/hughson-parkside.mjs](../../scripts/content/hughson-parkside.mjs), and the models
are [glass/models/coliseum.js](../../client/game/js/panels/glass/models/coliseum.js) and
[glass/models/parkside.js](../../client/game/js/panels/glass/models/parkside.js).

## 1. Sir Charles

The park is named for Charles Hughson, a dear friend, who is Sir Charles in the world.
He owned the ground the park stands on. Halcyon offered him a fortune for it three times, for
offices, and three times he sent the cheque back with two tickets in the envelope, so Halcyon built
its estate round him. He stood at the gate on opening day and shook every hand that came through.
Nobody knows who started calling him Sir, and he never asked anybody to stop.

Where it's told:

| Where | What |
|---|---|
| The rotunda | his statue on a granite plinth, the toes of its shoes rubbed gold for luck, and the inscription "He would not sell" |
| The rotunda wall | the dedication plaque: "For Sir Charles, who kept the gates open", and Halcyon's steel plate under it acknowledging "the existing structure" |
| The stands | his seat behind home plate, folded up, kept clean and never sat in |
| Ray Dombrowski | the `charles` node of his dialogue: the cheques, the handshake, the name |
| The booth | one sign-on line and four `chatter` lines for Chip Vega in [baseball.bsm](../../data/scripts/baseball.bsm) |
| The bowl wall | his name cut into the stone in one line, on Sorrel Way and again on Halcyon Boulevard (§5) |
| The main gate | two Guardians in the manner of Cleveland's bridge, GRANDSTAND in raised gilt on its plate, and the gilt sun with a baseball for its disc over it (§5) |
| The broadcast | the main gate's name plate in the 3-D view, painted as the map's (`sports_pools.venue.name`, §7) |
| The trades | Lorna Pruitt's mother's peanuts on opening day, the photograph over Mulcahy's fireplace, and Odessa Kimble on the sunburst (§10) |

⚠ **They tell one story.** Change a line in one place and check the others.

## 2. The site

The block is x 895 to 897, y 911 to 913, the middle of the north half of the estate's central
block, between Halcyon Boulevard and Sorrel Way. The Deadball row's `sports_pools.venue.site.block`
names the same nine tiles, and the content script refuses to run if the two disagree, because the
park on TV and the park on the map are meant to be one place. Home plate is in the south-east
corner, centre field is to the north-west (the venue's bearing of 315 degrees), and the foul lines
run along the tile grid.

| Tile | Zone | Type | Floors | What it is |
|---|---|---|---|---|
| 895,911 | `zone_ballpark_895_911` | `ballpark_bleachers` | 5 | the bleacher gate, north onto Halcyon Boulevard (map code `BG`), and the north-west light tower |
| 896,911 | `zone_ballpark_896_911` | `ballpark_n` | 4 | the north wall on the boulevard, under the fixed shell's fan window |
| 897,911 | `zone_ballpark_897_911` | `ballpark_ne` | 5 | the north-east corner and its light tower |
| 895,912 | `zone_ballpark_895_912` | `ballpark_w` | 4 | the west wall and its deck |
| 896,912 | `zone_ballpark_896_912` | `ballpark_c` | 4 | the field, under the roof's crown |
| 897,912 | `zone_ballpark_897_912` | `ballpark_e` | 4 | the first-base side and its deck |
| 895,913 | `zone_ballpark_895_913` | `ballpark_sw` | 5 | the south-west corner and its light tower |
| 896,913 | `zone_ballpark_896_913` | `ballpark_s` | 4 | the wall along Sorrel Way, under the roof's south fan window when it's shut |
| 897,913 | `zone_ballpark_897_913` | `ballpark` | 5 | the main gate, south onto Sorrel Way (map code `HC`), and the south-east light tower |

- **New ids, so nothing is overwritten.** The park's tiles are `zone_ballpark_<x>_<y>`, and the set-aside
  buildings keep their own `zone_district_<x>_<y>` ids. No runtime code builds a world tile's id
  from its coordinates; `sitecheck.mjs` did, and now looks a tile up by its place on the map.
- **Two doors.** The gates are facades written by `authorBuilding` (it takes a `facadeId` now, and a
  `roomName` prefix). The other seven tiles are sealed the way the Slush Fund's are: a name, a
  type, `entrance: south`, `floors`, empty exits and no `is_building`, so the map shows two codes
  for the park. `mint-connections` landed the walls round them as blocked connections.
- **Every tile carries `venue_lights` and `venue_roof`**, which are what light its field and move its
  roof (§6), and a `power_zones` row copied from the tile it replaced.

## 3. What was set aside

| Tile | Building | Interior | Keeper |
|---|---|---|---|
| 895,911 | 8 Halcyon Boulevard | `map_int_going` | Dorothea Crake |
| 896,911 | The Halcyon Institute | `map_int_course` | Hollis Quainton |
| 897,911 | Halcyon Land Office | `map_int_plot` | Merrick Follet |
| 895 to 897,912 | Vetch Green, three tiles | none | none |
| 895,913 | 3 Sorrel Way | `map_int_hf_assets` | none |
| 896,913 | 5 Sorrel Way | `map_int_hf_grounds` | Nadia Ferreira |
| 897,913 | 7 Sorrel Way | `map_int_hf_fit` | none |

Deleting a content file deletes its row on the next deploy and orphans any player row that points
at it, so none of these was deleted. Instead:

- **The nine tiles moved onto a holding map**, [map_set_aside](../../content/maps/map_set_aside.json),
  in the block's own layout one tile in from its origin (grid x minus 894, y minus 910), so the
  green still joins up and every facade faces the way it did. Each keeps its id, name, prose,
  flags, interior map, rooms, furniture and the connections into its rooms. Each carries
  `flags.set_aside`, and `flags.set_aside_from` says where it stood.
- **Nothing on the holding map connects to the world.** The six connection files between the
  facades and the streets were removed (the only files this build deleted), the street tiles'
  exits into the block and the grass tile's at 898,912 were cut, and each facade's
  `world_exit_zone` names the green in its own column. Regress checks both ways.
- **The four keepers carry `flags.set_aside` too.** They were vendors on the estate's vendor graph,
  which walks them to work and to an ATM; the game loop skips an NPC with that flag, so they stay
  in their home rooms with their routines paused.
- **Players.** [scripts/oneshots/set-aside-players.mjs](../../scripts/oneshots/set-aside-players.mjs)
  moves anyone standing in a set-aside room, anything on its floor and any corpse in it to the
  Coliseum's rotunda, and a respawn point in one back to the default. Rented rooms and player
  storefronts are listed for a person to decide, because each is a deal somebody made for that
  room. It reads the set-aside zones each run, so it converges and lives in `oneshots.bat`; run it
  after the deploy that lands this (`scripts\oneshots.bat prod`). The local database had nothing to
  move.
- **The models stay.** 8 Halcyon Boulevard, the Institute and the Land Office are drawn by their
  type arms in [old-coldwater.js](../../client/game/js/panels/glass/models/old-coldwater.js), 3 Sorrel
  Way by the `lens_hall` arm, and 5 and 7 Sorrel Way are bound by name in `NAMED_MODELS`. The types
  are still registered, so the shapes bake keeps them, and a building put back looks the same.

**Putting one back:** move its zone to a new plot on `map_world` (its `map_id` and grid), give the
street a link to the facade in the facade's entrance direction and point `world_exit_zone` at that
street, take `set_aside` and `set_aside_from` off the zone and `set_aside` off its keeper, then run
`node scripts/content/mint-connections.mjs --write` and `node scripts/content/sitecheck.mjs`.
[stored-buildings.md](stored-buildings.md) has the other way to take a building off the map.

## 4. Inside

Two gates, so two interior maps, joined by the aisle round the outfield: a connection file of its
own from the bleachers south to the stands. Room names are "The Coliseum" and the room, and every
one is under 30 characters, so `docs:prose` doesn't count the dash in it.

| Room | From | What's in it |
|---|---|---|
| Rotunda | the main gate (`map_int_hughson`) | the statue, the plaque, the turnstiles; the gates look onto Sorrel Way |
| Ticket Office | east of the rotunda | the seating plan, section nine crossed out in red |
| Concourse | north of the rotunda | the way through to the stands, the club level and the plant room |
| Concessions | west of the concourse | the concession stand and its cash drawer, Ray Dombrowski |
| The Stands | north of the concourse | the seats, Sir Charles's seat, the organ, the video board on channel 7 |
| Section Nine | west of the stands | the crater from Chip Vega's chatter, roped off |
| Club Level | up from the concourse | the bar, the windows over the field |
| Press Box | up from the club level | Chip Vega's desk and his chair |
| Plant Room | down from the concourse | the floods' breakers, two taped off; the roof's drive; the junction box |
| Bleachers | the bleacher gate (`map_int_hughsonbl`) | the benches, the scoreboard; south to the stands |
| Undercroft | down from the bleachers | under the planks; the bleachers' junction box |

⚠ **The concourse isn't the shop.** A room a vendor works in is a shop, and a shop locks outside his
hours ([shopdoor.js](../../plugins/commerce/shopdoor.js)), so with Ray at a counter in the concourse
the stands and the bleachers were shut six days a week. The regress walk found it. His counter has a
room of its own off the concourse.

**Ray Dombrowski** keeps the concession stand on the vendor graph: the Widowmaker (a new item, a
foot-long with a waiver printed on its boat), beer and coffee. He opens Monday, Wednesday and
Friday from 16:00 to 22:00, the game's nights. His greeting is split (`first`, `known`, `familiar`)
and he'll talk about Sir Charles, section nine and when they play.

Every room has a `power_zones` row and a fixture. Imported fixtures arrive switched off, and
`content/seed-runtime.mjs` switches them on.

## 5. GLASS

One arm, `ballpark` in [coliseum.js](../../client/game/js/panels/glass/models/coliseum.js), draws all
nine tiles. Each tile's row in [model-registry.js](../../client/game/js/panels/glass/model-registry.js)
says its column and row in the block (`bc`, `br`, from the north-west) and the facing it was
authored with (`facing`: south for eight of them, north for the bleacher gate).

- **The park is drawn in block coordinates**, u east and v south of the block's centre, in tiles,
  and each tile draws only what falls in its own square: flats are clipped to it, boxes are cut at
  its edges, and an arc is cut wherever it crosses a tile line. So the nine slices meet without a
  seam.
- ⚠ **The frame comes from the row's facing, not from `E`.** The two gates face opposite ways, and
  the shape bake captures each type at a facing of its own choosing. Block coordinates are turned
  into the model's frame by the declared facing, and `F` turns that frame to `E`, so a capture at
  another facing turns the whole slice with it. Only north and south are supported.
- ⚠ **Every flat is convex.** The flat painter fans a polygon out from its first point, and a clipped
  fan or L isn't star-shaped from wherever the clip leaves that point, so the field is laid as
  wedges from home plate and rectangles.
- ⚠ **The whole park is in constants**, as the Slush Fund's is, because `fh` and `h` are rolled per
  tile. The rows' floors in `TYPE_FLOORS` are what collision and the skyline read.
- **What it draws.**
  - The field: apron, track, grass, infield skirt, mound, foul lines, and the bags as low boxes,
    which is the field tile's only mass. Then the outfield wall, the foul poles, the grandstand in
    an L raked in three tiers, section nine, the bleachers, and the scoreboard past centre field.
  - The bowl, one wall round all four sides in five courses: a granite plinth, limestone
    (`ty_palais_stone`, the Palais's, for a deco hall kept up), a frieze, a glazed clerestory set back
    behind the fins, and a cornice flashed in copper. Marble-pale fins rank every face, with a tall
    concourse window in a bronze frame between each pair, a bronze spandrel over it and a gilt
    chevron in the spandrel. The window is three lights: the middle one the widest and tallest,
    the two either side stopped a step lower at a bronze panel, two transoms across, and a gilt
    sunburst rising off the step in the middle light's head. On the outfield faces, the boulevard
    and the west, it's a bigger window (`WIN_OPEN`) with no spandrel. It has five lights, about 40 ft
    wide from a 17 ft sill to 75 ft, and steps down twice toward the frame. Under the name band
    either window is square-headed with no sun. Their numbers and the sun are in
    [coliseum-window.js](../../client/game/js/panels/glass/coliseum-window.js), which the map and
    the broadcast both read. The east and west decks run in from the wall under the rails, on
    columns.
  - Four stepped light towers at the corners: a fluted shaft, two setbacks, a bronze lamp house with
    its floods turned to the field, a crown and a finial with a red beacon after dark.
  - The main gate on Sorrel Way, a stepped frontispiece between two Guardian pylons: a portal in
    three receding orders round bronze doors and a sunburst fanlight, a narrow grille gate with a
    lantern over it either side, GRANDSTAND on its plate, the gilt rising sun on the setback with a
    baseball for its disc, and the flag. The bleacher gate is its smaller twin with BLEACHERS on its
    plate.
  - The Guardians, after the Hope Memorial Bridge's in Cleveland: each pylon fluted below, and on a
    corbel halfway up a helmeted, square-shouldered figure in relief, robed to the feet, the west
    one cradling a gilt ball and the east one resting on a gilt bat held point-down. The figure is
    carved as convex outlines lit as stone (`carve`), not boxes: a box wears its palette's block
    joints, and a figure built of them read as stacked masonry. The relief is 0.013 deep at most,
    because the tile ends 0.02 off the frontispiece.
  - The roof: three shells, below.
- ⚠ **The name goes on twice, by request**: cut into the bowl wall on Sorrel Way and again on
  Halcyon Boulevard, an exception to one building, one name. Each face has a plain stone band
  under the frieze (`BAND`) on its longest clear run, from its gate to the far corner tower
  (`bandRun`); the windows under it stop short and the fins break round it. The name is one
  line in the `deco` hand, cut rather than raised: a dark copy up and left, a pale lip down and
  right, and the cut over both. Each word is baked cropped to its ink and the line is laid out
  from the bakes' widths, so each word is drawn whole by the tile its middle is on.
- The gate plates are built to the Meridian's standard: a flat bronze plate (a box would wear its
  palette's window skin over the letters) standing off the stone, a double gilt fillet, raised gilt
  letters in the `deco` hand that cast their shadow onto the plate (`embossText`, exported from
  coliseum.js for the trades), and on the main gate a halo round the plate after dark and
  floodlights under it.
- **The roof** is three segmental vaults across the bowl from rail to rail, each smaller and lower
  than the one before so they nest: the first fixed over the bleachers, the other two riding the
  rails' steps. Shut, they're one vault from Halcyon Boulevard to Sorrel Way; open, the two nest
  under the first and the field and the grandstand have the sky. Each is metal panels lit as
  `metal`, glazing down its crown, three bronze ribs, and two ends; the outer end of the first and
  the last is a fan window, glass behind bronze rays, a bronze frame and a hub on the sill. The
  gaps between the shells at the crown and mid-span are measured (0.025 to 0.03); change a rise
  and check.
- ⚠ **A moving roof is never mesh.** GLASS 2 caches the mesh per state: `venueKey` in
  [gl/world.js](../../client/game/js/panels/gl/world.js) adds the game night and the roof (shut,
  open, or moving) to `meshParams`, `placeOf` hands the same state to the capture, and the window
  key is memoised against `venueEpoch`, which a push or a roof arriving where it was going bumps. At
  rest the shells are drawn into the mesh where they rest; while they travel the mesh has none and
  the arm lays them down as depth-writing decals at the position they've reached, and asks
  `dutyPhase` so the arm-keep record never freezes them. GLASS 1 draws them every frame as flats.
  ⚠ The shape is the shut roof whatever the roof is doing, a stepped envelope of boxes under each
  facet: the shape is per model, not per state, and collision, the occluders and the distance LOD
  read it. A pilot who drops into the open bowl meets the roof line, which is rarer and less wrong
  than flying through a dome that looks solid. The skin goes into the mesh as roof faces, not trim,
  because as flats it stood 0.84 over the field tile's only mass and `gl:mesh` failed it.
- **Registrations:** `TYPE_MODEL` (with `noKit`, palette `ty_palais_stone`), `TYPE_FLOORS` (five at
  the corners for the towers, four elsewhere for the vault), `BLDG_TYPE_3D`, `BUILDING_TYPE_ICON` and
  [bldg_ballpark.svg](../../client/game/assets/zone-icons/bldg_ballpark.svg) (a vault between two
  towers over a diamond, for both gates), the shapes and lights bakes, the flight-world snapshot and
  the wildlands field.

## 6. The lights and the roof

**The lights** burn at a working level (0.42) every night from dusk, and at full while the show that
plays at the park is on air.

- The broadcast plugin's sports heartbeat, once a minute, lights every tile of the block of any
  sports script on air now that names a venue block, and `venue.lit` answers from that set. It's
  synchronous and reads no table, because the map window asks it.
- The flight derive asks it for a tile with `flags.venue_lights` and puts `vl` on the cell (0 in a
  static bake). A view that's open when it changes is told by a `venue_lit` push, which
  [world-feed.js](../../client/game/js/panels/world-feed.js) keeps by tile.
- With the roof open, the towers' lamp houses and the floods under the decks burn and each tower
  throws a pool of light on the field. With it shut, the light comes out through the clerestory all
  round, the fan windows and the crown glazing. The concourse windows are lit every night.

Deadball is on KSAB, channel 7, at 18:00 on Monday, Wednesday and Friday, so those are the full
nights, and Ray Dombrowski's hours follow them.

**The roof** is shut on days forecast wet and open on dry ones.

- The same heartbeat decides it for every venue whose tiles carry `flags.venue_roof`, grouped by
  `building_name` so one park has one answer, from today's forecast, not the sky over the park: shut
  if the day's forecast is wet (rain, sleet, snow, a storm, a blizzard, ash) or gives a 40% chance or
  more of anything falling, open otherwise (`roofWeather`). So it moves when the forecast day turns
  over, not under a passing shower.
- Staff can open or shut it now with `sysop roof open|shut` or the Admin app's Roof tab. That call
  holds until the forecast day changes; `sysop roof auto` hands it back sooner.
- `venue.roof` answers `{ shut }` from that set, synchronous and query-free; the derive puts `vr`
  on the cell (1 shut; a static bake shows it shut, so a picture with no weather behind it is the
  dome), and a change is pushed as `venue_roof`.
- [world-feed.js](../../client/game/js/panels/world-feed.js) `noteVenueRoof` starts the shells moving
  from wherever they are, over five minutes, eased out of rest and back into it (`ROOF_MS`).
  `venueState` is the cell as amended by the pushes, and is what the mesh key and the arm both read.

## 7. On TV

The broadcast's 3-D park stands in the same Coliseum: the field and the stands are the broadcast's
own, at full size, and the bowl round them is the map's model, transcribed
([gl/ballpark-mesh.js](../../client/game/js/panels/gl/ballpark-mesh.js) `buildBowl`, drawn by
[gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js)).

- **The map's numbers at the broadcast's size.** `B2T` takes the map's block coordinates to the
  bowl's feet ([diamond/geo.js](../../client/game/js/panels/diamond/geo.js) `fromBlock`, `ftUp`).
  The bowl is a square on the foul lines, 168 ft behind home on the two near sides and 445 ft out on
  the far ones (`BOWL`), so a map tile is 208.5 ft across it and 226 ft up it. The wall's five
  courses, the fins, the four corner towers, the decks and their rails, the two gates and the three
  shells are the map's, and a change in [coliseum.js](../../client/game/js/panels/glass/models/coliseum.js)
  wants the same change here. `parkOutline` is the bowl's square, so the city, the streets and the
  gulls stand round the same footprint.
- ⚠ **The main gate is placed, not transcribed.** On the map it stands on Sorrel Way straight across
  from home plate, and the map's home plate sits nearer the corner than the broadcast's, so on TV it
  stands across from the broadcast's (`MAIN_U`). The street camera looks up at it from the crossing
  outside ([diamond/streets.js](../../client/game/js/panels/diamond/streets.js) `STREET_EYE`). The
  bleacher gate is where the map has it.
- ⚠ **The left-field deck's columns stand at its back.** The map's columns stand 1.18 tiles out on
  both sides; on the left-field side that's in the broadcast's bleachers.
- **The wall** between the fins is painted in the shader (`EXTERIOR_GLSL`): coursed limestone, and in
  every bay a concourse window in a bronze frame with the map's tracery and sun, the bronze spandrel
  over it and the gilt chevron, the concourse lit behind every night and the floods washing up the
  stone. Under the name band the window stops short of it with no spandrel, as on the map: the
  shader reads the band's run on each face from `BAND_UV`, keyed by the side seed in the wall's
  colour. The rest of the bowl is geometry, shaded as `DECO` stone, `GILT` bronze and gilt, and
  `GLAZE` glass lit from inside.
- **The outfield faces are open.** On the boulevard and the west, the faces beyond the outfield,
  each window's glass is cut through both skins of the wall (`wallRects` cuts the painted wall
  round the holes), so from the field the city shows through them. These are the bigger windows
  (`WIN_OPEN`). From home plate the bleachers hide the wall below about 40 ft, so the window's
  height is what lets the city show. Behind each opening is a concourse 15 ft deep, with a floor at
  the sills, a ceiling at the heads and a lamp strip lit every night. The window's bronze is
  geometry in the outer skin (`tracery`): mullions, transoms, the stepped head panels and the gilt
  sun. Its glass is one translucent pane (`glazing`, `GLAZE` with uv.x 2, which lights nothing).
  The open faces' wall carries green 1 in its colour, so the shader paints the bigger frame round
  the holes and no spandrel. Sorrel Way and the east keep their windows painted, because the
  grandstand stands against them. On the map the outfield stands are banked against the wall's
  inside, so only the broadcast cuts through. The two bays behind the bleacher gate stay shut and
  are painted, so there are 18 openings. `ballpark-smoke` checks the panes and that no piece of the
  wall crosses an opening.
- ⚠ **A gate's body stops inside the wall** (`GATE_BACK`), 0.004 tiles short of the inner face. It
  used to run back to the inner face's own plane, and from the field its stone fought the window
  painted there in streaks.
- **The name band** is the map's `BAND` on the run `bandRun` picks, on Sorrel Way and on the
  boulevard (`BAND_RUNS`), and the fins break round it. His name is cut into it in one line in
  Limelight: the cut's upper wall in shadow up and left, its lit lip down and right, and the cut over
  both, set as wide as the run allows inside 0.05 tiles at each end. The band's face is a `DECO` quad
  a hair proud of its stone, textured from the plates' atlas, so it takes the stone's light and
  coursing and meets the band without a seam. Each face's line is painted once across two cells,
  the reader's left half and the right, each cell its half of the band's shape in feet.
  ⚠ **The atlas paints the stone grey** (`BAND_STONE`), so the lip can be paler than the stone round
  it; the quad's colour is the band's over that grey, so the stone matches its box.
- **The Guardians** are the map's, line for line: the pylons, their stepped caps and flutes, the
  corbels, and the carved figures with the gilt ball on the west one and the gilt bat on the east.
  ⚠ The figures are `DECO` with a negative uv (`DRESSED`), which the shader leaves uncoursed, because
  the wall's 2.6 ft joints across a figure read as stacked masonry. ⚠ The ball's height is its
  radius times `KH / ftUp(1)`, not the map's 1/1.4, so it stays round at this view's proportions.
  The grille gates either side are the map's narrow ones.
- **The plates** are painted to the map's measures (`paintPlateCanvas`, one atlas, `PLATE_ATLAS`):
  dark bronze, a double gilt fillet, and GRANDSTAND on the main gate's (`MAIN_PLATE`, 0.33 by 0.09
  tiles, clear of the Guardians) and BLEACHERS on the bleacher gate's, in raised gilt in Limelight,
  every letter lit along its top and casting its shadow down and to the right. ⚠ **No line is ever
  squeezed**: one too long for its space is set smaller. The plate stands off the frontispiece on a
  bronze bracket, with a halo round it after dark. `ballpark-smoke` holds the plates and the band
  to this.
- **The roof** is three batches, one a shell, built shut and drawn where the roof has got to
  (`shellShift`, the `uShift` uniform). The broadcast puts the roof on every Gameday line as it airs
  (`roof`, 1 shut and 0 open, from `venue.roof` at the block's middle tile, `gamedayOnAir`). The view
  hands it to the renderer (`setRoof`), which rolls the shells over the map's five minutes
  (`roofTrack`, world-feed.js `ROOF_MS`) and keeps drawing while they move. Until a payload says, the
  roof is shut, as the map's static picture is.
- **The lights go with the roof.** There are six: a tower at each corner and a lamp row under each
  deck. Open, the towers and the rows light the field. As the shells come over, each tower's light
  fades out by the time they're halfway and comes up again at its place under a deck (`under` in the
  venue's towers, `roofLights`), so no light jumps while it's lit, and the towers' floods go dark.
  The four tower lights cast the players' shadows from wherever their light is.
- **Under a shut roof** the field stays dry, nothing falls on a camera inside the bowl, the gulls stay
  down, and after dark the glazing down each crown and the clerestory glow (`uDome`). The sky shows
  over the infield and the grandstand only when it's open.
- The fans in the stands and the people walking to the gates are one figure
  ([gl/ballpark-mesh.js](../../client/game/js/panels/gl/ballpark-mesh.js) `crowdMesh`), rebuilt the same
  day so it reads as a person by its outline: a torso lofted from rings with shoulders broader
  than the hips, a head on top of it, upper arms and forearms, hands, legs and shoes. It's 256 to
  260 triangles at the far level and 456 to 460 at the near, inside the gate's 260 and 460. A part
  code's quarter values say which limb a vertex is on (`CROWD_PART`), so the walker in
  [gl/streetlife.js](../../client/game/js/panels/gl/streetlife.js) swings exactly its arms and legs.

## 8. Tests

- `tests/regress.js` walks in at the main gate from Sorrel Way, through the concourse and the stands
  to the bleachers and out onto Halcyon Boulevard; checks the nine tiles and the two doors; checks
  that nothing on the holding map connects to the world either way, that every set-aside building
  keeps its interior, its furniture and a way out on the holding map, and that its four keepers
  are home.
- `plugins/broadcast/regress.js` lights a block and puts it out again, and checks the derive's `vl`
  both ways and that a static bake never bakes it in. It shuts the roof in handed-in rain, holds it
  shut a minute into the dry, opens it after twenty, shuts it again, and checks the derive's `vr`,
  that a static bake shows it shut, and that a Gameday line airs with the roof where it is.
- `tests/regress.js` checks every park tile is under the roof, and that each trade's door opens off
  its street into its own counter where its keeper works, with the five buildings it replaced on
  the holding map.
- `shapes:smoke` runs the arm on all nine types at night and by day at both facings,
  `ballpark-smoke` holds the crowd's figure to its budget and its poses to each other,
  `cityscape-smoke` builds the TV's city from the skyline the map now carries, and `content:lint`
  holds the content.
- `ballpark-smoke` holds the TV's bowl to the map's: the square outline, the wall facing out between
  the plinth and the frieze, the plate across from home on Sorrel Way, a tower at each corner. It
  checks the shells shut over the whole bowl and nest open, clear each other by five to eight feet,
  and spring from the rails; that the lights cross to the decks with no jump; that the roof's travel
  eases over ninety seconds and turns back from wherever it is; and that the plates letter his name
  over COLISEUM, raised and never squeezed. `diamond-smoke` checks a payload's `roof` reaches the
  renderer and one without leaves it alone.

## 9. What isn't built

- **Seats in person**, the plan's last and largest piece: watching the game from the stands in the
  3-D view with no graphics, tickets at the turnstile, and a foul ball as an item. Today the stands'
  video board is a television on channel 7. The plan is [coliseum-seats.md](coliseum-seats.md).
- **The roof in the text.** The rooms' prose describes the roof but not whether it's open; nothing
  reads `venue.roof` but the map and the broadcast.
- **Carts on the map.** The cart yard is described but draws as paved ground.
- **People in the map's stands.** The map's park has no crowd; on a game night it's lit and empty.
- **New plots for the set-aside buildings.** They wait on the holding map.

## 10. The trades round it

The plots either side of the park on x 894 and x 898 were Halcyon's glass and chrome. They're the
trades a ballpark street has now, written by
[scripts/content/hughson-parkside.mjs](../../scripts/content/hughson-parkside.mjs) and drawn by
[glass/models/parkside.js](../../client/game/js/panels/glass/models/parkside.js), one type each.

| Plot | Building | Type | Door | Keeper | Sells |
|---|---|---|---|---|---|
| 898,913 | Coliseum Box Office | `box_office` | south, Sorrel Way, beside the main gate | Bernadette Okafor | tickets, the pocket schedule, scorecards |
| 894,911 | Fitz's Franks | `frank_stand` | north, Halcyon Boulevard, beside the bleacher gate | Fitz Rourke | franks, sausage on a roll, cola, lemon soda, beer |
| 894,912 | Pruitt's Peanuts & Pretzels | `peanut_roaster` | west, Vetch Mews | Lorna Pruitt | peanuts, pretzels, popcorn, lemon soda |
| 898,911 | Mulcahy's Sports Bar | `sports_bar` | north, Halcyon Boulevard | Declan Mulcahy | beer, wings, cream soda, cola; the game on a set on channel 7 |
| 894,913 | Kimble's Souvenirs & Cards | `souvenir_shop` | south, Sorrel Way | Odessa Kimble | pennants, caps, foam fingers, scorecards; a card machine |
| 898,912 | Cart Yard | ground | | | paved, where the carts park |

- ⚠ **No puns in Halcyon Fields.** The box office is the park's own and says so; the other four
  carry their keepers' names and their trade, so each says what it sells and none needs
  `flags.sign_trade`.
- **Each is an `authorBuilding` door** with a new id (`zone_parkside_<x>_<y>`), two rooms and a
  utility room, a light per room, a till, and a `power_zones` row copied from the plot. Game nights
  keep the food and the bar open late. Every keeper's greeting is split, and each knows a piece of
  Sir Charles's story (§1).
- **What they replaced is set aside** on row 9 of the holding map, the way §3 describes:
  6 Halcyon Boulevard, 8 Vetch Mews and the Halcyon Sales Suite on the west, 1 and 5 Kettle Lane on
  the east, with their keepers Ambrose Fewtrell, Odile Marchetti, Adaeze Okonjo and Ottilie
  Marchbank. Rows 5 and 7 are other builds'.
- **The models** are one tile each, in constants, with the park's language at a smaller size: the
  box office in its limestone and gilt with a brass queue rail, the frank stand white-tiled under a
  striped awning with a neon frank on the roof, Pruitt's in red brick with a copper roaster on a
  cart and a pretzel on a bracket, Mulcahy's in dark brick with green neon and pennants under the
  eaves, and Kimble's in cream tile with pennants fanned in the window and a baseball on the
  parapet. Each has a map icon of its own (`bldg_<type>.svg`).
