# The Charles B. Hughson Coliseum *(as built)*

**Status: BUILT, but for seats in person.** Deadball's ballpark, on the map: nine tiles in Halcyon
Fields, two gates, eleven rooms, one vendor, one GLASS arm over nine building types, a map icon, and
light towers that come on while the game is on air. The six buildings and the green it replaced
are set aside on a holding map, not deleted. Built 2026-10-18 as Phase 6 of
[deadball-glass2.md](deadball-glass2.md#phases), which called the park Halcyon Field.

The content is written by [scripts/content/hughson-coliseum.mjs](../../scripts/content/hughson-coliseum.mjs)
and the model is [glass/models/coliseum.js](../../client/game/js/panels/glass/models/coliseum.js).

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
| The broadcast | the park's name lit over the main gate in the 3-D view (`sports_pools.venue.name`) |

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
| 895,911 | `zone_ballpark_895_911` | `ballpark_bleachers` | 2 | the bleacher gate, north onto Halcyon Boulevard (map code `BG`) |
| 896,911 | `zone_ballpark_896_911` | `ballpark_n` | 1 | the outfield wall on the boulevard, the scoreboard behind it |
| 897,911 | `zone_ballpark_897_911` | `ballpark_ne` | 2 | the right-field corner and a light tower |
| 895,912 | `zone_ballpark_895_912` | `ballpark_w` | 1 | the left-field side and a light tower |
| 896,912 | `zone_ballpark_896_912` | `ballpark_c` | 1 | the field |
| 897,912 | `zone_ballpark_897_912` | `ballpark_e` | 3 | the first-base grandstand, its back to Kettle Lane |
| 895,913 | `zone_ballpark_895_913` | `ballpark_sw` | 2 | the third-base end and a light tower |
| 896,913 | `zone_ballpark_896_913` | `ballpark_s` | 3 | the grandstand along Sorrel Way |
| 897,913 | `zone_ballpark_897_913` | `ballpark` | 3 | the main gate, south onto Sorrel Way (map code `HC`) |

- **New ids, so nothing is overwritten.** The park's tiles are `zone_ballpark_<x>_<y>`, and the set-aside
  buildings keep their own `zone_district_<x>_<y>` ids. No runtime code builds a world tile's id
  from its coordinates; `sitecheck.mjs` did, and now looks a tile up by its place on the map.
- **Two doors.** The gates are facades written by `authorBuilding` (it takes a `facadeId` now, and a
  `roomName` prefix). The other seven tiles are sealed the way the Slush Fund's are: a name, a
  type, `entrance: south`, `floors`, empty exits and no `is_building`, so the map shows two codes
  for the park. `mint-connections` landed the walls round them as blocked connections.
- **Every tile carries `venue_lights`**, which is what lights its towers (§6), and a `power_zones`
  row copied from the tile it replaced.

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
| Plant Room | down from the concourse | the towers' breakers, two taped off; the junction box |
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
- **What it draws:** the field (apron, track, grass, infield skirt, mound, foul lines, and the bags as
  low boxes, which is the field tile's only mass), the padded outfield wall and the foul poles, the
  grandstand in an L along Sorrel Way and Kettle Lane raked in three tiers under the upper deck's
  roof and stepping down toward the corners, its arcade lit from the concourse after dark, flags
  on the back wall, the rotunda at the main gate with the name across its front, the bleachers
  along the two outfield edges with BLEACHERS painted over their gate, the scoreboard on its legs
  past centre field, and six light towers. The name goes on once, on the rotunda.
- **Registrations:** `TYPE_MODEL` (with `noKit`), `TYPE_FLOORS`, `BLDG_TYPE_3D`, `BUILDING_TYPE_ICON`
  and [bldg_ballpark.svg](../../client/game/assets/zone-icons/bldg_ballpark.svg) (a diamond in a fan
  of outfield, for both gates), the shapes and lights bakes, the flight-world snapshot and the
  wildlands field.

## 6. Game nights

The light towers are on while the show that plays at the park is on air.

- The broadcast plugin's sports heartbeat, once a minute, lights every tile of the block of any
  sports script on air now that names a venue block, and `venue.lit` answers from that set. It's
  synchronous and reads no table, because the map window asks it.
- The flight derive asks it for a tile with `flags.venue_lights` and puts `vl` on the cell (0 in a
  static bake), and the GL window key includes it.
- A view that's open when it changes is told by a `venue_lit` push, which
  [world-feed.js](../../client/game/js/panels/world-feed.js) keeps by tile; the arm reads that first
  and the cell's `vl` after it.
- On, the lamp banks burn white, a red beacon tops each mast and each tower throws a pool of light
  on the field after dark; off, the lamps are grey steel.

Deadball is on KSAB, channel 7, at 18:00 on Monday, Wednesday and Friday, so those are the lit
nights, and Ray Dombrowski's hours follow them.

## 7. On TV

- The 3-D park lights the venue's name over its main gate. A long name steps the sign's face down
  before `fillText` squeezes it ([gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js)
  `paintSign`); squeezed, the Coliseum's 27 letters came out at 70% of their width.
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
  both ways and that a static bake never bakes it in.
- `shapes:smoke` runs the arm on all nine types at night and by day at both facings,
  `ballpark-smoke` holds the crowd's figure to its budget and its poses to each other,
  `cityscape-smoke` builds the TV's city from the skyline the map now carries, and `content:lint`
  holds the content.

## 9. What isn't built

- **Seats in person**, the plan's last and largest piece: watching the game from the stands in the
  3-D view with no graphics, tickets at the turnstile, and a foul ball as an item. Today the stands'
  video board is a television on channel 7. The plan is [coliseum-seats.md](coliseum-seats.md).
- **People in the map's stands.** The map's park has no crowd; on a game night it's lit and empty.
- **New plots for the set-aside buildings.** They wait on the holding map.
