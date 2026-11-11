# The Charles B. Hughson Coliseum *(as built)*

**Status: BUILT, but for seats in person.** Deadball's ballpark, on the map and on TV: 25 tiles in
Halcyon Fields, true size on TV, four gates, thirteen rooms, one vendor, one GLASS arm over 25 building
types, a map icon, the Hughson Dome, a clamshell of three stepped shells on rails that opens it and shuts it for the weather, and field lights every night. It's an
art deco park from the Meridian's decade, kept up, under a roof added long after. Five ballpark
trades stand on the plots either side of it (§10), and Halcyon's estate and the Hughson towers stand north
and west of it ([hughson-estate.md](hughson-estate.md), [hughson-towers.md](hughson-towers.md)). What's still off the map is set aside on a holding map,
not deleted. Built
2026-10-18 as Phase 6 of [deadball-glass2.md](deadball-glass2.md#phases), which called the park
Halcyon Field, and rebuilt in deco with the roof the same day. On 2026-11-02 it went to true size,
11 by 11 tiles, with the city grown west to the river round it ([coliseum-true-size.md](coliseum-true-size.md)),
on 2026-11-03 its three shells gave way to eight turning leaves, on the map and on TV together, on
2026-11-04 the map's park came down to five tiles in the corner of its lot, with TV left at true size
([coliseum-five-tiles.md](coliseum-five-tiles.md)), and later that day the shells came back in the
leaves' copper, steps, ribs and lantern. This page describes it as it stands now.

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
| Yarrow Lane | the cheques and the ground lease at 889,911, and his brass plate in the paving at 889,912 |
| The trades | Lorna Pruitt's mother's peanuts on opening day, the photograph over Mulcahy's fireplace, and Odessa Kimble on the sunburst (§10) |

⚠ **They tell one story.** Change a line in one place and check the others.

## 2. The site

Sir Charles's whole lot is x 887 to 897, y 910 to 920: Halcyon Boulevard along the north, Sorrel Way
along the south, the river road and the Curtain on the west, and the trades on x 898 to the east. The
park is at x 891 to 895, y 914 to 918, two tiles in from the lot's south and east edges, so home plate
stands a quarter tile from where TV has it ([coliseum-five-tiles.md](coliseum-five-tiles.md#two-tiles-north)). The rest
is Hughson Way, which comes down x 892 from Halcyon Boulevard to the park's north wall, down x 896 past
its east wall to Sorrel Way, and once ran along its south wall on y 919, which is Grandstand Plaza now, in front of Hughson Gardens ([hughson-gardens.md](hughson-gardens.md)), with a run west on y 915 to GATE D, eleven Halcyon buildings ([hughson-estate.md](hughson-estate.md))
and the Hughson towers on the old car park and green ([hughson-towers.md](hughson-towers.md)). The
ground is still his. The towers stand on a ground lease, and nothing in the world says he sold any of it. The Deadball row's
`sports_pools.venue.site.block` names the same 25 tiles and
`site.x`/`site.y` home plate, which is 894.61,917.61. `site.set` is the broadcast's own ground, the whole
lot with home plate at 894.86,917.86. Home plate is 168 ft in from the south-east corner, centre field is to the
north-west (the venue's bearing of 315 degrees), and the foul lines run along the tile grid.

⚠ **The plan is [client/shared/coliseum-plan.js](../../client/shared/coliseum-plan.js).** The park is
drawn in park units (the bowl's outer face at 1.47, its cornice at 0.46 up). On the map one unit is
SH (5/3) tiles across and SV (1.81) up, and on TV it's 208.5 ft and 226 ft, the size the broadcast
always drew it. The bowl's numbers, the gates, home plate, the field and every tile's type
and floors are there, and the map's arm, the broadcast's bowl, the registries and TYPE_FLOORS read
them.

Four tiles are doors; the other 21 are sealed slices (`ballpark_<bc>_<br>`, column and row from the
north-west), each walled on every side a neighbour could walk in from.

| Tile | Type | Door | Street |
|---|---|---|---|
| 894,918 | `ballpark` | the main gate, south, straight across from home plate (map code `HC`) | Hughson Way, with Grandstand Walk on to Sorrel Way and Fitz's Franks |
| 891,914 | `ballpark_bleachers` | the bleacher gate, north (`BG`) | a short cut off Hughson Way at 891,913 |
| 895,914 | `ballpark_gate_c` | GATE C, east (`G3`), a hall into the bleachers | Hughson Way at 896,914 |
| 891,915 | `ballpark_gate_d` | GATE D, west (`G4`), a hall into the bleachers | Hughson Way at 890,915 |

⚠ **The main gate is on Hughson Way on the map and on Sorrel Way on TV.** `site.set` is TV's own ground,
and the map's bowl is block-relative, so the Guardians, the plates and the name band on the south face
stand over Hughson Way here. On foot the gate is one straight walk from Sorrel Way up Grandstand Walk.

The nine tiles the park first stood on (x 895-897, y 911-913) are Hughson Green, Hughson Way and the
plots of 9 and 11 Hughson Way now. Their gates moved, and their rooms with them.

- **New ids, so nothing is overwritten.** The park's tiles are `zone_ballpark_<x>_<y>`, and the set-aside
  buildings keep their own `zone_district_<x>_<y>` ids. No runtime code builds a world tile's id
  from its coordinates; `sitecheck.mjs` did, and now looks a tile up by its place on the map.
- **Four doors.** The gates are facades (GATE C and GATE D written by `authorBuilding`, which takes a
  `facadeId`, a `streetId` and a `roomName` prefix). The other 21 tiles are sealed the way the Slush
  Fund's are: a name, a type, `entrance: south`, `floors`, empty exits and no `is_building`, so the
  map shows four codes for the park. coliseum-park.mjs walls them with blocked connections.
- **Every tile carries `venue_lights` and `venue_roof`**, which are what light its field and move its
  roof (§6), and a `power_zones` row copied from the tile it replaced.

## 3. What was set aside

At true size (2026-11-02) the whole square went the same way: its 112 street and meadow tiles
(after the buildings on it had moved to new plots, [coliseum-true-size.md](coliseum-true-size.md#where-each-one-went))
are on `map_set_aside` rows 11 to 21, grid x minus 886 and y minus 899, with `flags.set_aside_from`.

The nine-tile park set aside six buildings and Vetch Green on 2026-10-18, and the trades set aside
five more buildings (§10). All eleven buildings went back onto the lot on 2026-11-04, with their
eight keepers ([hughson-estate.md](hughson-estate.md)). What's still on the holding map from the park:

| Tiles | Holding grid | What they are |
|---|---|---|
| Vetch Green, three tiles | 1 to 3,2 | the green from 895 to 897,912, with no plot to go to |
| Hughson Green, eleven tiles | rows 1, 3 and 9, in the cells the buildings left | the green tiles the buildings displaced, each with `flags.set_aside_from` naming its plot |
| 112 street and meadow tiles | rows 11 to 21 | the true-size square |

Deleting a content file deletes its row on the next deploy and orphans any player row that points
at it, so none of these was deleted. Instead:

- **A tile moves onto a holding map**, [map_set_aside](../../content/maps/map_set_aside.json), and
  keeps its id, name, prose, flags, interior map, rooms, furniture and the connections into its
  rooms. It carries `flags.set_aside`, and `flags.set_aside_from` says where it stood.
- **Nothing on the holding map connects to the world.** The connection files between facades and
  streets are removed, the street tiles' exits into the block are cut, and each facade's
  `world_exit_zone` stays on the holding map. Regress checks both ways.
- **A keeper carries `flags.set_aside` too.** The vendor graph walks a keeper to work and to an ATM;
  the game loop skips an NPC with that flag, so they stay in their home rooms with their routines
  paused.
- **Players.** [scripts/oneshots/set-aside-players.mjs](../../scripts/oneshots/set-aside-players.mjs)
  moves anyone standing in a set-aside room, anything on its floor and any corpse in it to the
  Coliseum's rotunda, and a respawn point in one back to the default. Rented rooms and player
  storefronts are listed for a person to decide, because each is a deal somebody made for that
  room. It reads the set-aside zones each run, so it converges and lives in `oneshots.bat`; run it
  after the deploy that lands this (`scripts\oneshots.bat prod`). The local database had nothing to
  move.
- **The models stay.** A set-aside building's type or name stays registered, so the shapes bake keeps
  it, and a building put back looks the same.

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
| Rotunda | the main gate (`map_int_hughson`) | the statue, the plaque, the turnstiles; the gates look onto Hughson Way and Grandstand Walk |
| Ticket Office | east of the rotunda | the seating plan, section nine crossed out in red |
| Concourse | north of the rotunda | the way through to the stands, the club level and the plant room |
| Concessions | west of the concourse | the concession stand and its cash drawer, Ray Dombrowski |
| The Stands | north of the concourse | the seats, Sir Charles's seat, the organ, the video board on channel 7 |
| Section Nine | west of the stands | the crater from Chip Vega's chatter, roped off |
| Club Level | up from the concourse | the bar, the windows over the field; `stands` here buys a Platinum Box ticket, ₵150, twice the Diamond Club |
| Platinum Box | east of the club level | the big screen (`watch tv`, the game in 3-D), the sofa, the bar and the buffet, both bottomless (`restock_items`, every item worth ₵0). Ticket holders only |
| Box Seats | north of the Platinum Box | the white armchairs behind the glass; `sit` in one and the park opens from it; the ticket covers it. In GLASS 2 the box is a 3-D suite you walk round, hung over the back rows of the lower bowl level with first base, in front of the upper deck (the zone's `stands` section `room`). Nearer home the bowl curves into it |
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
25 tiles. Each tile's row in [model-registry.js](../../client/game/js/panels/glass/model-registry.js),
generated from the plan, says its column and row in the block (`bc`, `br`, from the north-west) and
the facing it was authored with (`facing`: south for all but the doors; north for the bleacher
gate, east for GATE C, west for GATE D).

- **Park units, scaled where they reach a primitive.** `L`, `P` and `B3` turn a park point into
  the tile's frame at SH across, heights are ZK (= SV) up, and the sizes handed to `box`, `seg`,
  `drum`, `pool` and the flag scale the same way. Anything round in a vertical plane (the suns, the
  Guardian's ball, the lettering's fit) is squashed by SH / ZK so it stays round.
- ⚠ **A gate is wider than its tile.** The main and bleacher gates each span three tiles, so the
  tile a gate's middle is on draws all of it, its clip widened across the gate while the gate's
  section runs. GATE C and GATE D are a plain stepped frontispiece each, cut tile by tile.
- ⚠ **The roof's shape is boxes under its skin.** Under SHAPE_SINK the shells' faces cut each tile
  three by two, and each cell becomes one box from the lowest point of the roof over it to the
  highest, so the shape's top and base are the mesh's (gl:mesh) and a tile holding nothing but roof
  starts where the roof does. Two traps. The cells aren't square, because the kit rings any square
  roofed box in coping (derived-kit.js `deck`), and on quarter tiles that drew a grid over the roof.
  And the skin sits inside those boxes, so its faces carry `noAO` and the AO bake leaves them open
  (gl/world.js `bakeFaceAO`); without it the roof baked dark in the same grid.

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
  - Four stepped towers at the corners: a fluted shaft, two setbacks, a bronze lamp house, a crown
    and a finial with a red beacon after dark, and a flag on the crown's outer corner. They carry no lamps.
  - Ten light poles, five on each deck's roof behind the girder (`POLES` in the plan), on the map    and the broadcast: a steel mast, a catwalk and a bank of floods turned to the field, clear of    the shells' rails. On the broadcast the four end poles carry the venue's casting lights.
  - The main gate on Sorrel Way, a stepped frontispiece between two Guardian pylons: a portal in
    three receding orders round bronze doors and a sunburst fanlight, a narrow grille gate with a
    lantern over it either side, GRANDSTAND on its plate, the gilt rising sun on the setback with a
    baseball for its disc, and a stepped crown over it. The bleacher gate is its smaller twin with BLEACHERS on its
    plate.
  - The Guardians, after the Hope Memorial Bridge's in Cleveland: each pylon fluted below, and on a
    corbel halfway up a helmeted, square-shouldered figure in relief, robed to the feet, the west
    one cradling a gilt ball and the east one resting on a gilt bat held point-down. The figure is
    carved as convex outlines lit as stone (`carve`), not boxes: a box wears its palette's block
    joints, and a figure built of them read as stacked masonry. The relief is 0.013 deep at most,
    because the tile ends 0.02 off the frontispiece.
  - The roof: the Hughson Dome, below.
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
- **The roof is the Hughson Dome**, a clamshell in the SkyDome's manner: three stepped barrel vaults on
  bronze girders, from the east deck to the west. Its numbers are the plan's (`DOME`, `SHELLS`,
  `GIRDER`, `LANTERN` in [coliseum-plan.js](../../client/shared/coliseum-plan.js)), which the broadcast
  builds from too. The first shell is fixed over the grandstand on Sorrel Way, behind and above home
  plate; the other two ride the rails south and nest under it, so the roof opens from the boulevard
  and the open roof is parked behind the plate, out of the view to the outfield (`FIXED_END`). Each arch sets back three
  times on the way up, a ziggurat end on, with five bronze ribs across each shell and glass over its
  two upper tiers, so more of the roof is glass than copper. The panels are copper gone dark brown, lit as `plain` (as `metal` they mirrored the
  sky and read blue). The girders are bronze bands with a gilt chevron frieze, which runs across the
  boulevard's sill too, and inside them the rails step down and in, one for each level. The two outer
  ends are glass fans behind bronze rays, in a bronze frame round the stepped arch, on a gilt hub.
  The last shell's fan rides with it, so open it faces the field. The fans, the sills and the frieze
  follow `FIXED_END` (`isFan`, `sillZ`). The lantern stands on the fixed
  shell's crown, because nothing can stand over the middle of a roof that slides away: two drums of
  glass in bronze mullions under a fluted gilt cap, and on its stem the main gate's sun with a baseball
  for its disc, facing all four streets, with the red beacon over it after dark.
- ⚠ **A shell nests by its level.** Level k is the top shell's arch taken `dr` in and set `g` lower, and
  the profile never rises outward, so each level clears the one over it by at least `g` (about seven
  feet) everywhere, and a rib passes under the steel of the shell over it. Change `g`, `dr` or the rib
  and run `ballpark-smoke`.
- ⚠ **The crown stands at 0.85 for the skyline.** From the field the Halcyon and Ascendant towers stand
  over the roof and through its glass, and that view is what the park is known for. At 1.05 the vault
  shut them out. It's 28 m on the map, under the corner towers' lamp houses. Change `H` or `zs` and
  look from home plate first.
- ⚠ **The roof parks behind home plate for the skyline.** Home looks north-west over centre field, and
  the city climbs to the right of that line to the Ascendant Spire ten tiles north. Parked at the
  boulevard end (as it was until 2026-11-10), the open roof blocked the outfield sky from the horizon
  up to between 30 and 39 degrees. Parked over Sorrel Way, it leaves the sky over the outfield clear
  up to between 58 and 72 degrees, and only the grandstand sits under it.
- ⚠ **The feet stay inside the towers.** `DOME.R0` is 1.22 and the girder ends at 1.26 because a corner
  tower's inner side is 1.265 and the vaults run the bowl's whole length past all four. The leaves'
  ring was 1.33 because a circle only touched the sides.
- ⚠ **Above the spring, nothing stands behind the fan.** The last shell's fan is just behind the main
  gate's face, so on the map the gate's upper boxes start in front of it (`FV`). Run back to the wall,
  the setback and crown stood inside the vault and showed through the glass.
- ⚠ **A moving roof is never mesh.** GLASS 2 caches the mesh per state: `venueKey` in
  [gl/world.js](../../client/game/js/panels/gl/world.js) adds the game night and the roof (shut,
  open, or moving) to `meshParams`, `placeOf` hands the same state to the capture, and the window
  key is memoised against `venueEpoch`, which a push or a roof arriving where it was going bumps. At
  rest the two moving shells are drawn into the mesh where they rest (shut or nested); while they
  travel the mesh has neither and the arm lays them down as depth-writing decals where they've
  got to, and asks `dutyPhase` so the arm-keep record never freezes them. The girders, the lantern and
  the fixed shell are mesh in every state. GLASS 1 draws the shells every frame as flats.
  ⚠ The shape is the shut roof whatever it's doing, the stepped envelope above: the shape is
  per model, not per state, and collision, the occluders and the distance LOD read it, so from far
  off the roof is those boxes and the lantern. A pilot who drops into the open bowl meets
  the roof, which is rarer and less wrong than flying through one that looks solid. The skin goes
  into the mesh as roof faces, not trim, because as flats it stood well over the field tiles' only
  mass and `gl:mesh` failed it.
- **Registrations:** `TYPE_MODEL` (with `noKit`, palette `ty_palais_stone`), `TYPE_FLOORS` (eight at
  the corners and on the roof's shoulders, ten under its crown), `BLDG_TYPE_3D`, `BUILDING_TYPE_ICON` and
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
- With the roof open, the poles' banks and the floods under the decks burn. A glow sits only on a
  bank's face: a pool out over the field or behind the wall read from the street as lights hanging
  in the air. With it shut, the light comes out through the clerestory all
  round, the fan windows and the crown glazing. The concourse windows are lit every night.

Deadball is on KSAB, channel 7, at 18:00 on Monday, Wednesday and Friday, so those are the full
nights, and Ray Dombrowski's hours follow them.

**The roof** is shut on days forecast wet and open on dry ones.

- The same heartbeat decides it for every venue whose tiles carry `flags.venue_roof`, grouped by
  `building_name` so one park has one answer. It shuts if the day's forecast is wet (rain, sleet,
  snow, a storm, a blizzard, ash) or colder than 10C (`roofWeather`), and is open otherwise,
  overcast included. On an open day it shuts the first time anything falls on one of the park's
  tiles (`roofRainedOn`, read from `getPrecipAtGrid`) and stays shut until the forecast day turns
  over, so a run of showers doesn't swing it back and forth.
- Staff can open or shut it now with `sysop roof open|shut` or the Admin app's Roof tab. That call
  holds until the forecast day changes; `sysop roof auto` hands it back sooner.
- `venue.roof` answers `{ shut }` from that set, synchronous and query-free; the derive puts `vr`
  on the cell (1 shut; a static bake shows it shut, so a picture with no weather behind it is the
  dome), and a change is pushed as `venue_roof`.
- [world-feed.js](../../client/game/js/panels/world-feed.js) `noteVenueRoof` starts the shells moving
  from wherever they are, over five minutes, eased out of rest and back into it (`ROOF_MS`).
  `venueState` is the cell as amended by the pushes, and is what the mesh key and the arm both read.

### The people, from the air

On a game night with the roof open, a flight over the park sees the fans and the two teams. The arm
(`parkPeople`, step 10b) puts a fan in most seats and hands the figures to `parkFigures` in
windshield.js, which sends them to [gl/actors.js](../../client/game/js/panels/gl/actors.js) as the
pavement's people: the same body and clips baked into a texture, plus `sit` and `cheer` for the
stands. Only a camera above the cornice draws them, and only on GLASS 2.

- The broadcast sends `venue_play` (who's home and away, the half, outs and the runners) off each aired
  line's score-bug, when it changes. [world-feed.js](../../client/game/js/panels/world-feed.js)
  keeps it by tile (`venuePlay`). The fielding side stands in its positions, and the batter and the
  runners are the batting side, in `clubColour`'s first colour over grey; the umpire's in black.
- With no channel airing the game there are no lines and no push, so the home side fields and
  nobody's on.
- ⚠ The arm hands `parkFigures` a function, not a list: a kept building replays a live part's
  recorded arguments, and a list would freeze the play it was recorded at.
- The play on the ball (a swing, a runner going, a fielder after the ball) isn't drawn. Each line's
  gameday payload has it, and would be the next step.
- `PARK_PREVIEW.game` fakes a game night with the roof open for the Modelshop; `parkFigStats` counts
  what was offered and pushed.

## 7. On TV

The broadcast's 3-D park stands in the same Coliseum: the field and the stands are the broadcast's
own, at full size, and the bowl round them is the map's model, transcribed
([gl/ballpark-mesh.js](../../client/game/js/panels/gl/ballpark-mesh.js) `buildBowl`, drawn by
[gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js)).

- **The plan's numbers, through the ruler.** `B2T` takes the plan's park units to the bowl's feet
  ([diamond/geo.js](../../client/game/js/panels/diamond/geo.js) `fromBlock`, `ftUp`) as SH and SV
  tiles of TILE_FT feet each, which is 208.5 ft a unit across and 226 ft up: the size the map draws
  it now. The bowl is a square on the foul lines, 168 ft behind home on the two near sides and 445 ft
  out on the far ones (`BOWL`). The wall's five
  courses, the fins, the four corner towers, the decks, the gates and the roof are the plan's, and a
  change in [coliseum.js](../../client/game/js/panels/glass/models/coliseum.js)
  wants the same change here. `parkOutline` is the bowl's square, so the city, the streets and the
  gulls stand round the same footprint.
- **The main gate is transcribed like the rest.** At true size the map's home plate is the
  broadcast's, so both stand the gate straight across from it (`GATE.u` is home plate's u). The
  street camera looks up at it from across Sorrel Way, never closer than 45 ft to its foot
  ([diamond/streets.js](../../client/game/js/panels/diamond/streets.js) `STREET_EYE.off`), because
  the road now runs along the wall and the nearest corner was the gate's step. GATE C and GATE D
  stand on TV too, with bare bronze plates (the map letters them), and GATE D takes one of the west
  face's openings, so there are 17.
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
  grandstand stands against them. The map cuts the same openings (`wallRects`, in coliseum-window.js so both read it), with no glass in them, so the city shows through from the field and the field from the boulevard. The two bays behind the bleacher gate stay shut and
  are painted, as is the one behind GATE D, so there are 17 openings. `ballpark-smoke` checks the panes and that no piece of the
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
- **The roof** is three batches, one a shell, each built shut and drawn along its rails as far as the
  roof has got (`shellShift`, the `uShift` uniform, which the lit pass and the towers' shadow pass add
  to position). The girders, rails, sills and lantern are in the bowl's own batches. Each shell has its
  underside, painted steel, a steel arch under every rib, pale Warren trusses between them and purlins
  along the vault, none hanging past `SHELL_STEEL`. ⚠ An inner end is a beam, not a wall: the map closes
  every end, which nobody sees from above, and from the field that walled the roof off where one shell
  meets the next. Only the two outer ends are walls, the glass fans. The broadcast puts the roof on every Gameday line as it airs
  (`roof`, 1 shut and 0 open, from `venue.roof` at the block's middle tile, `gamedayOnAir`). The view
  hands it to the renderer (`setRoof`), which moves the shells over the map's five minutes
  (`roofTrack`, world-feed.js `ROOF_MS`) and keeps drawing while they move. Until a payload says, the
  roof is shut, as the map's static picture is.
- **Daylight comes through the shut roof** (`SKY_IN`, gl/ballpark.js). By day the field's light is the
  towers' and the decks', and shutting the roof hands it to the dimmer rows under the decks, so a shut
  roof carries up to 0.9 more at noon and nothing at night.
- **The city past the wall** is composed round the whole lot, not the map's five tiles (`site.set`,
  887 to 897 by 910 to 920, with the true-size home plate), because that's the ground the broadcast's
  park fills. Composed round the five, the warp pushed the Halcyon towers eight tiles back behind low
  blocks and the field lost them. `site.block` stays what the roof and the lights answer for. The
  venue's Halcyon quarter has `towers`, so about a quarter of the set's filler there stands 24 to 60
  storeys tall in six forms (see [systems-broadcast.md](../systems-broadcast.md)).
- **The lights go with the roof.** There are six: a tower at each corner and a lamp row under each
  deck. Open, the towers and the rows light the field. As the shells come over, each tower's light
  fades out by the time they're halfway and comes up again at its place under a deck (`under` in the
  venue's towers, `roofLights`), so no light jumps while it's lit, and the towers' floods go dark.
  The four tower lights cast the players' shadows from wherever their light is.
- **Under a shut roof** the field stays dry, nothing falls on a camera inside the bowl, the gulls stay
  down, and after dark the glazing strip along each shell and the clerestory glow (`uDome`). The sky shows
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
  to the bleachers and out onto Hughson Way, then up the road to Halcyon Boulevard; checks the nine tiles and the two doors; checks
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
  checks the three shells roof the bowl end to end shut and lie under the fixed one open, that each
  level clears the one over it by six to eight feet with the steel and the ribs in the gap, that a
  rib slides under the steel over it, that each shell springs from its rail, that the girders stand
  inside the towers, that the lantern stands on the fixed shell, and that the renderer slides a shell
  where the plan does; that the lights cross to the decks with no jump; that the roof's travel
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

## 10. The trades round it

The plots either side of the park on x 894 and x 898 were Halcyon's glass and chrome. They're the
trades a ballpark street has now, written by
[scripts/content/hughson-parkside.mjs](../../scripts/content/hughson-parkside.mjs) and drawn by
[glass/models/parkside.js](../../client/game/js/panels/glass/models/parkside.js), one type each.

| Plot | Building | Type | Door | Keeper | Sells |
|---|---|---|---|---|---|
| 898,913 | Coliseum Box Office | `box_office` | south, Sorrel Way, beside the main gate | Bernadette Okafor | tickets, the pocket schedule, scorecards |
| 894,922 | Fitz's Franks | `frank_stand` | north, Sorrel Way, at the foot of Grandstand Walk, straight down from the main gate (until 2026-11-02 at 894,911 beside the bleacher gate, then at 896,922) | Fitz Rourke | franks, sausage on a roll, cola, lemon soda, beer |
| 900,919 | Pruitt's Peanuts & Pretzels | `peanut_roaster` | west, Kettle Lane (until 2026-11-02 at 894,912 on Vetch Mews) | Lorna Pruitt | peanuts, pretzels, popcorn, lemon soda |
| 898,911 | Mulcahy's Sports Bar | `sports_bar` | north, Halcyon Boulevard | Declan Mulcahy | beer, wings, cream soda, cola; the game on a set on channel 7 |
| 896,922 | Kimble's Souvenirs & Cards | `souvenir_shop` | north, Sorrel Way, beside Fitz's Franks (until 2026-11-02 at 894,913, then at 898,920 with its door south until 2026-11-09) | Odessa Kimble | pennants, caps, foam fingers, scorecards; a card machine |
| 898,912 | Cart Yard | ground | | | paved, where the carts park |

- ⚠ **No puns in Halcyon Fields.** The box office is the park's own and says so; the other four
  carry their keepers' names and their trade, so each says what it sells and none needs
  `flags.sign_trade`.
- **Each is an `authorBuilding` door** with a new id (`zone_parkside_<x>_<y>`), two rooms and a
  utility room, a light per room, a till, and a `power_zones` row copied from the plot. Game nights
  keep the food and the bar open late. Every keeper's greeting is split, and each knows a piece of
  Sir Charles's story (§1).
- **What they replaced has gone back.** 6 Halcyon Boulevard, 8 Vetch Mews and the Halcyon Sales Suite
  on the west and 1 and 5 Kettle Lane on the east waited on row 9 of the holding map, the way §3
  describes, and moved onto the lot on 2026-11-04 with Montague Fewtrell, Lavinia Fairlie, Adaeze
  Okonjo and Ottilie Marchbank. Three of them have new addresses: 2, 9 and 11 Hughson Way
  ([hughson-estate.md](hughson-estate.md)).
- **The models** are one tile each, in constants, with the park's language at a smaller size: the
  box office in its limestone and gilt with a brass queue rail, Fitz's Franks a hot dog the size of
  its plot, shaped like a hot dog truck (a two-lobed bun whose ends round off into noses that lift
  off the ground, the frank running on past them to rounded ends, mustard along the top, the hatch
  and its striped awning in the bun's straight front wall facing the main gate; David, 2026-11-09),
  Pruitt's in red brick with a copper roaster on a
  cart and a pretzel on a bracket, Mulcahy's in dark brick with green neon and pennants under the
  eaves, and Kimble's in cream tile with pennants fanned in the window and a baseball on the
  parapet. Each has a map icon of its own (`bldg_<type>.svg`).
