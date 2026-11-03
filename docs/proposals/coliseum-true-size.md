# The Coliseum at true size

> **Status: built. Phases 1-4 on 2026-11-02, the Hughson Dome on 2026-11-03.** The Curtain runs down the
> river bank and along y 923, and the South Gate and the Glacis moved four rows south with it
> ([coliseum-ground.mjs](../../scripts/content/coliseum-ground.mjs)). The 23 buildings and the
> Helipad are on their new plots ([Where each one went](#where-each-one-went)). The park stands on
> 121 tiles at true size with four gates ([coliseum-park.mjs](../../scripts/content/coliseum-park.mjs)),
> and the map and the broadcast read one plan for it ([coliseum-plan.js](../../client/shared/coliseum-plan.js)),
> the Hughson Dome included: eight stepped leaves, six of them turning to open it, on a bronze ring
> under a glazed lantern. See [As built](#as-built) for what came out differently. [hughson-coliseum.md](hughson-coliseum.md)
> describes the park as it stands.

## The decision

The world scale proposal (PR #62) puts every drawn thing on one ruler, 17.857 m a tile. The
Coliseum's bowl is a square on the foul lines about 613 ft (187 m) a side, drawn today on a 3 by 3
block by stretching a map tile to 208.5 ft. Dave's call (2026-11-01): **build it at true size and
grow the city to make room**, rather than keep the stretch.

At the ruler 187 m is 10.5 tiles, so the park is **11 by 11 tiles** (196 m, 643 ft, a few metres of
apron round the bowl on each side).

The broadcast's park has always been true size; only the map was squeezed. At 11 by 11 the map and
the broadcast describe the same park, and the TV side gets simpler: `B2T`'s 208.5 ft a tile becomes
the ruler's 58.6.

## Where it goes

Halcyon Fields is Coldwater's south-west corner: the Curtain runs down its west side at x 891 and
along its south side at y 919, the South Gate is at x 911, and the district is 163 tiles, 20 wide by
11 tall. West of the wall is the Rust Flats, then a river at about x 881 to 884.

**The whole square is Sir Charles's lot** (Dave, 2026-11-01). The 3 by 3 block was the park drawn
small, not the size of what he owned. Halcyon built its estate round the full lot, which is the
story [hughson-coliseum.md §1](hughson-coliseum.md#1-sir-charles) already tells; the map now agrees
with it. Nothing marks a smaller lot inside the park, because there never was one.

Three sites were tried, each an 11 by 11 square that contains the old 3 by 3 block:

| Site | Square | What it takes | Verdict |
|---|---|---|---|
| North-west | x 887-897, y 903-913 | 44 hardpan tiles, 27 buildings in the **Glasshouse** and the Filaments: the Spire, the Ascension Gate, the Architect Shrine, the Vats | No. The Glasshouse is the Ascendants' seat, priority one in [goals.md](../goals.md) |
| South | x 892-902, y 911-921 | 22 hardpan tiles, 36 Halcyon buildings, the south wall | Possible, but takes most of the estate's south half |
| **West to the river** | **x 887-897, y 910-920**, a street on y 909 | **57 hardpan tiles, 17 wall tiles, 23 Halcyon buildings** | **Chosen** (Dave, 2026-11-01) |

A sketch, not a survey: the park's square, the walls and the new rows are exact; the streets and
buildings east of the park are drawn roughly.

```
        x 885 . . . . . . . . 895 . . . . . . . 905
 y 908  # . b . b . . . = . b = b . b b = = = . b        (the Glasshouse's southern edge)
 909    # = = = = = = = = = = = = = = . b b b =          new north street; the bleacher gate opens onto it
 910    #[B B B B B B B B B B B]= b b b = b b b          [ ]  the new park, 11 x 11, Sir Charles's lot
 911    #[B B B B B B B B B B B]h . h h . b = . .         B   park tile
 912    #[B B B B B B B B B B B]. = h h = h h . b         #   the Curtain, moved to the river bank
 913    #[B B B B B B B B B B B]h = h h = h h . b         ~   the river beyond it
 914    #[B B B B B B B B B B B]h h = h h . h . .
 915    #[B B B B B B B B B B B]h h = h h . h h h
 916    #[B B B B B B B B B B B]= = = = = = = = .
 917    #[B B B B B B B B B B B]h h h h h h h h h
 918    #[B B B B B B B B B B B]= = = = = = = = .
 919    #[B B B B B B B B B B B]. . . . . . . . .
 920    #[B B B B B B B B B B H]. . . . . . . . .        H   home plate, the south-east corner
 921    # = = = = = = = = = = = = = = = = = = = =        new Sorrel Way, past the main gate
 922    # p p p p p p p p p p p p p p p p p p p          p   new plots for what the park displaced
 923    # # # # # # # # # # # # # # # # # # # # #        the south wall, moved down four rows
```

- **Home plate stays in the south-east corner** and centre field stays north-west (the venue's 315
  degrees), so the park is the same park at its real size.
- **A street on every side.** The new north street on y 909 keeps the park off the Glasshouse and
  carries the bleacher gate, as Halcyon Boulevard does now. The river road runs down the west side,
  the new Sorrel Way along the south, and the trades street on x 898 along the east.
- **The west wall moves to the river bank**, x 885, from y 901 to 923. A river is a better edge
  than a line on the hardpan, and the Curtain's purpose (a wall on the land sides) is unchanged.
- **The south wall moves down four rows**, to y 923 from x 885 to the South Gate road. The new
  Sorrel Way runs along y 921 past the main gate, and y 922 holds new plots.
- **East of the park is untouched.** The Box Office, Mulcahy's and the Cart Yard on x 898 already
  face the park and stay where they are.

### Decided on the ground (Dave, 2026-11-02)

The sketch above is two columns west of the text; the text is right. A survey of the tiles turned
up four things the plan didn't cover:

- **The South Gate moves south with the wall.** The gate, the South Lock, the Outer Lock and the
  Glacis round it (the weighbridge, the Tow Bay, the Search Pad, the Gate Post and the Motor Pool)
  move down four rows as one piece: the inner lock to 911,921-922, the gate to 911,923 and the
  outer works to y 924-926. The tiles keep their ids, so everything that names them follows. East of
  the gate the wall turns north up x 913 to its old line at y 919 (moved from x 912 the next day by
  [coliseum-jog.mjs](../../scripts/content/coliseum-jog.mjs), so the lock has meadow beside it and
  the jog an inland side).
- **x 886 is the river road.** The wall on x 885 and the park on x 887 leave one column, and the
  road down the west face and GATE D take it. Houses go on the Sorrel Way plots and on the new
  ground north of the park.
- **The wall's move also takes in x 886-890 from y 902 to 908**, west of the Glasshouse. The
  Helipad and the Threshold hangar's ramp move there off the new north street, out from under the
  drum.
- **The names move with the park.** The new north street on y 909 is Halcyon Boulevard and the
  new street on y 921 is Sorrel Way, so his name is still cut on Sorrel Way and Halcyon Boulevard.
  The ends of the old streets east of the park keep their names. GATE C opens onto the Cart Yard
  (898,912); Kettle Lane on x 899 is the trades street.

## What moves

The 23 buildings in the square and the new north street go to `map_set_aside`, as the nine tiles the park first replaced
did ([hughson-coliseum.md §3](hughson-coliseum.md#3-what-was-set-aside)), and are re-sited, not
deleted:

| Group | Buildings | Goes to |
|---|---|---|
| The park's own trades | Pruitt's Peanuts & Pretzels, Fitz's Franks, Kimble's Souvenirs & Cards | The new Sorrel Way, either side of the main gate, as §10 had them either side of the old one |
| Civic | Coldwater Recital Hall, Halcyon Pavilion, The Winter Garden, Halcyon West Halt | New plots on y 921; the West Halt keeps its line, one stop further along |
| Houses | 1, 2, 7, 9, 11 Halcyon Boulevard (four of them where the north street goes); 1, 2, 6, 8, 10, 12, 15 Kerbstone Row; 1 and 4 Sorrel Way; 5 and 7 Vetch Mews | New plots on y 921 and the Rust Flats strip at x 886, keeping their names and their keepers |

Each moves with its zone, its furniture, its NPCs' homes and its keepers' vendor graph, and its
`flags.set_aside_from` records where it stood.

### Where each one went

As built (2026-11-02, [scripts/content/coliseum-resite.mjs](../../scripts/content/coliseum-resite.mjs)),
none of them went by way of `map_set_aside`: each moved straight to its new plot and kept its id,
so it carries no `set_aside_from`, and this table is the record. Each kept its entrance too, because
a hall's other exits collide with a door turned round, so each plot has a street on its door's side.
The meadow tile on each plot moved into the square in its place, for phase 3 to set aside with the
rest of the block.

| Building | Was | Now | Door onto |
|---|---|---|---|
| 1, 7, 9, 11 Halcyon Boulevard | 892, 895, 896, 897 on y 909 | 887, 888, 890, 891 on y 908 | Halcyon Boulevard, south |
| 5 Vetch Mews, 7 Vetch Mews, 1 Sorrel Way | 892,913, 892,912, 892,914 | 888,906, 888,905, 888,904 | the new Vetch Mews (x 889), east; 7 is sealed |
| Helipad (`af_helipad`) | 893,909 | 890,904 | open ground on Vetch Mews |
| Halcyon West Halt, Coldwater Recital Hall, 4 Sorrel Way, 2 Halcyon Boulevard | 893,917, 893,911, 895,915, 892,911 | 888, 890, 892, 894 on y 922 | Sorrel Way, north |
| Fitz's Franks | 894,911 | 896,922 | Sorrel Way, north, across from the main gate |
| Kimble's Souvenirs & Cards | 894,913 | 898,920 | Sorrel Way, south, beside the main gate |
| Pruitt's Peanuts & Pretzels | 894,912 | 900,919 | Kettle Lane, west |
| 2, 6, 8, 10, 12 Kerbstone Row | 892, 894, 895, 896, 897 on y 917 | 901 to 905 on y 919 | Windrow Lane, north; 8 is sealed |
| Halcyon Pavilion, The Winter Garden, 1 Kerbstone Row, 15 Kerbstone Row | 894,915, 896,915, 892,915, 897,915 | 900, 902, 904, 906 on y 920 | Sorrel Way, south |

The addresses didn't change, so the Kerbstone Row houses stand on Windrow Lane and 2 Halcyon
Boulevard on Sorrel Way. Their room prose was rewritten for what's outside the windows now. A
parked aircraft keeps its own grid, so
[repark-moved-pad-aircraft.mjs](../../scripts/oneshots/repark-moved-pad-aircraft.mjs) (in
`oneshots.bat`) stands anything parked on the Helipad on its new tile.

## The building: the Hughson Dome

The park keeps its name, the Charles B. Hughson Coliseum, and its art deco: it's the Meridian's
decade, kept up. What the new size buys is a dome, and with it the finest building in the game.
Everything in [hughson-coliseum.md §5](hughson-coliseum.md#5-glass) carries over unless this says
otherwise: the Palais limestone, the marble fins, the bronze spandrels and gilt chevrons, the
three-light concourse windows and their sunbursts, the name cut twice, the `deco` hand, the gate
plates to the Meridian's standard.

**The drum.** The bowl wall becomes a square drum 196 m a side in the same five courses (granite
plinth, limestone, frieze, glazed clerestory, copper cornice), at true height: about 32 m, nine
storeys, to the ring. The corners are chamfered, so the plan is a square that turns its corners,
and each chamfer carries a light tower.

**The dome.** A ribbed dome on a ring 170 m across, springing from the top of the drum and rising
about 42 m, so the crown stands some 74 m over the street, the tallest thing in Halcyon Fields.

- **Eight leaves**, like the gores of an orange, meeting at a lantern. The two over centre field
  and the bleachers are fixed; the other six turn on the ring and nest under them, so the dome opens
  from home plate outward and the field and the grandstand get the sky. The mechanism is Pittsburgh's
  Civic Arena's; the dress is deco.
- **Each leaf steps.** Its rib is a stepped bronze fin, a ziggurat seen from the side, setting back
  three times on its way up; between ribs, copper panels gone a dark brown, and a strip of glazing
  down the middle of each leaf that lights the field by day and shows the dome lit from inside at
  night.
- **The ring** is a bronze band with a gilt chevron frieze, on brackets over the cornice, carrying
  the rails the six leaves run on.
- **The lantern** at the crown is a stepped drum of glass in bronze mullions under a fluted gilt
  cap and a finial: a gilt sun with a baseball for its disc, the main gate's emblem at the top of
  the building. The finial carries the red beacon after dark.

**The towers.** The four corner light towers become pylons that rise past the ring to about 60 m,
fluted, setting back twice, each with a bronze lamp house whose floods throw over the ring into the
field when the dome is open, and a crown and flag over that. With the dome shut they're the four
points the dome sits between, which is the silhouette from across the Basin.

**The gates.** The main gate on Sorrel Way becomes a full frontispiece rising the height of the drum:
three receding orders round bronze doors, a sunburst fanlight two storeys tall, four Guardians now
(two either side, ball and bat, helmeted and robed to the feet as at the Hope Memorial Bridge), and
GRANDSTAND on its plate. The bleacher gate opens north onto the new street as its smaller twin. The
west face on the river road and the east face on the trades street get one secondary gate each,
because a 196 m wall with two doors is a wall people walk round: GATE D on the river road and GATE C
on the trades street (Dave, 2026-11-01).

**The windows.** The concourse windows rank all four faces between the fins, about forty to a face
instead of a handful. The outfield faces keep the bigger five-light window (`WIN_OPEN`), now at the
scale it was drawn for.

**At night.** The clerestory lit all round, the leaves' glazing strips lit, the lantern glowing and
the beacon on the sun. With the dome open, the four lamp houses blaze over the ring instead.

**Inside, on TV.** From the field the dome is a ribbed ceiling of eight stepped gores, the glazing
strips running to the lantern. The broadcast's bowl is transcribed from the map's model, as now, so
the booth sees the same dome.

### What it asks of GLASS

- **The dome opens and shuts in five minutes** (Dave, 2026-11-01), eased out of rest and back into
  it, as the shells did (`ROOF_MS`).
- **The leaves turn; they don't slide.** The rule stands that a moving roof is never mesh: at rest
  the six leaves are drawn into the mesh where they rest (shut or nested), and while they travel the
  arm lays them as depth-writing decals at the angle they've reached. The shape stays the shut dome.
- **One arm, more types.** 121 tiles is too many to give each its own type for the bake. The tiles
  fall into about a dozen roles (four corners, the four sides by face, the gates, the field under
  the dome, the stands ring), each a type with its block column and row on its registry row, as
  the nine are now.
- **The dome crosses every tile.** The arm already cuts arcs at tile lines; a leaf is cut the same
  way, so each tile draws the slice of the dome over it.
- **Distance.** From far off the dome is the skyline's silhouette, so its far LOD keeps the leaves,
  the ring and the lantern and drops the fins and windows.

## The work

| Part | What changes | Where |
|---|---|---|
| Ground | The Curtain's west and south runs, the new tiles on the Rust Flats and below y 919, the glacis | content `zones`, `flags.curtain`; `npm run wildlands:bake` after the edge moves |
| Set-aside and re-siting | 23 buildings to `map_set_aside`, then onto new plots | a content script in the style of `hughson-parkside.mjs`; `scripts/content/sitecheck.mjs` before siting |
| The park | 121 tiles, their connections, the gates on the new streets | `scripts/content/hughson-coliseum.mjs`; `sports_pools.venue.site.block` (the script refuses to run if the two disagree) |
| GLASS | The `ballpark` arm redrawn as the Hughson Dome over an 11 by 11 block; about a dozen tile types; 121 registry rows; `TYPE_FLOORS` (nine storeys to the ring, more at the towers); the turning leaves; the far LOD | `glass/models/coliseum.js`, `coliseum-window.js`, `model-registry.js`, `gl/world.js`'s venue key |
| The broadcast | `B2T` and `ftUp` read the ruler; `buildBowl` transcribes the dome; `parkOutline`, the street camera and `MAIN_U` re-placed | `diamond/geo.js`, `gl/ballpark-mesh.js`, `diamond/streets.js` |
| Unchanged | The Platinum Box and every stands section | They're in the field's feet, which don't move |
| Docs | The site, GLASS and TV sections; the infill's map; the trades table | `hughson-coliseum.md`, `halcyon-fields-infill.md` |

Gates: `content:lint`, `sitecheck`, `shapes:smoke` (every one of the 121 slices, night and day),
`imports:smoke`, and `test:regress`, which needs a database, so this is built at a desk.

## As built

Phases 1 to 4 landed on 2026-11-02 and the dome on 2026-11-03. Where the build differs from the plan
above:

- **The dome is lower than drawn.** The ring is 169 m across on a bronze band to 39 m, the leaves
  rise to 72 m and the lantern's beacon to 87 m: a rise of about 34 m, not 42. The leaves'
  quarter-ellipse sets back three times (`DOME.steps`), and each level nests seven feet under the
  one over it. The two fixed leaves are A and B either side of centre field; the six that turn
  meet over home plate.
- **The towers are as they were.** The nine-tile park's towers were already pylons with lamp
  houses, and at true size they stand 62 m, above the ring and below the dome's crown, so they're
  unchanged.
- **The roof over the drum's corners.** A round dome on a square drum leaves four corners between
  the ring and the wall; they're roofed flat in copper (`CORNER_Z`), and the scoreboard came down
  under it.
- **The far LOD is the shape.** The dome's shape is boxes three by two to a tile, each from the
  lowest point of the dome over it to the highest, plus the ring's boxes and the lantern's drums, so
  that's what the distance LOD draws; the fins and windows are the smallest segments and go first.
- **The rows' `floors` weren't raised.** The roof tiles still say 17 storeys (`tileFloors`), about
  60 m, under the dome's 72; the skyline reads them. Raising them rewrites 121 zones' content.
- **One plan, not a transcription.** The bowl's numbers live once in
  [coliseum-plan.js](../../client/shared/coliseum-plan.js), in park units, with what a unit is on the
  ruler (SH tiles across, SV up). The map's arm draws them at that size and the broadcast's
  `B2T` reads the same ruler, so the broadcast's park didn't change at all and the map's grew 3.6
  times to meet it. The dome is in the plan too, so the TV's roof and the map's are one.
- **About ten windows a face, not forty.** The broadcast's bays are 51 ft, which is what the map
  draws at true size, and a five-light window 40 ft wide doesn't fit forty to a 613 ft face.
- **Two Guardians, not four.** The main gate is the nine-tile park's at its true size.
- **The corners aren't chamfered**, and the towers stand on them as before.
- **GATE C and GATE D lead into the bleachers**, the one room with both sides free; on TV their
  plates are bare bronze.
- **The TV city.** The set round the park ([city-set.js](../../client/shared/city-set.js)) needed
  three changes for a wall two rows off the park: the ring road along the park wins over the lane
  inside the wall (Sorrel Way along the park, plots behind it), a building that can't find a plot
  within seven looks within ten, and a walker's line to a gate stays on road, plaza or park. The
  street cameras stand at least 45 ft off the main gate's foot
  ([streets.js](../../client/game/js/panels/diamond/streets.js) `STREET_EYE.off`).

## Phases

1. The ground: move the Curtain and lay the new tiles. Nothing else changes.
2. Set aside and re-site the 23 buildings, so the estate is whole before the park grows.
3. The park on 121 tiles, content and the Hughson Dome together, behind the same gate check the 3 by 3 had.
4. The broadcast onto the ruler.
5. The Hughson Dome, on the map and on TV from one plan (the park in phase 3 kept the shells).
