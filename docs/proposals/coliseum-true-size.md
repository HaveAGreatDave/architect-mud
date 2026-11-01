# The Coliseum at true size

> **Status: design.** Nothing here is built. [hughson-coliseum.md](hughson-coliseum.md) describes
> the park as it stands, on nine tiles, and wins until this lands.

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
11 tall. West of the wall is the Rust Flats, then a river at about x 881 to 884. Sir Charles's
ground is x 895 to 897, y 911 to 913, and the park keeps all of it.

Three sites were tried, each an 11 by 11 square that contains his ground:

| Site | Square | What it takes | Verdict |
|---|---|---|---|
| North-west | x 887-897, y 903-913 | 44 hardpan tiles, 27 buildings in the **Glasshouse** and the Filaments: the Spire, the Ascension Gate, the Architect Shrine, the Vats | No. The Glasshouse is the Ascendants' seat, priority one in [goals.md](../goals.md) |
| South | x 892-902, y 911-921 | 22 hardpan tiles, 36 Halcyon buildings, the south wall | Possible, but takes most of the estate's south half |
| **West to the river** | **x 887-897, y 909-919** | **44 hardpan tiles, 17 wall tiles, 23 Halcyon buildings** | **Proposed** |

A sketch, not a survey: the park's square, the walls and the new rows are exact; the streets and
buildings east of the park are drawn roughly.

```
        x 885 . . . . . . . . 895 . . . . . . . 905
 y 908  # . b . b . . . = . b = b . b b = = = . b
 909    #[B B B B B B B B B B B]. = . b . b b b =        [ ]  the new park, 11 x 11
 910    #[B B B B B B B B B B B]= . b b b = b b b         B   park tile
 911    #[B B B B B B B B o o o]h . h h . b = . .         o   Sir Charles's ground (now right field)
 912    #[B B B B B B B B o o o]. = h h = h h . b         #   the Curtain, moved to the river bank
 913    #[B B B B B B B B o o o]h = h h = h h . b         ~   the river beyond it
 914    #[B B B B B B B B B B B]h h = h h . h . .
 915    #[B B B B B B B B B B B]h h = h h . h h h
 916    #[B B B B B B B B B B B]= = = = = = = = .
 917    #[B B B B B B B B B B B]h h h h h h h h h
 918    #[B B B B B B B B B B B]= = = = = = = = .
 919    #[B B B B B B B B B B H]. . . . . . . . .        H   home plate, the south-east corner
 920    # = = = = = = = = = = = = = = = = = = = =        new Sorrel Way, outside the old wall line
 921    # p p p p p p p p p p p p p p p p p p p          p   new plots for what the park displaced
 922    # # # # # # # # # # # # # # # # # # # # #        the south wall, moved down three rows
```

- **Home plate stays in the south-east corner** and centre field stays north-west (the venue's 315
  degrees), so the park is the same park, eleven times the size. His ground is now deep right field.
- **The west wall moves to the river bank**, x 885, from y 901 to 922. A river is a better edge
  than a line on the hardpan, and the Curtain's purpose (a wall on the land sides) is unchanged.
- **The south wall moves down three rows**, to y 922 from x 885 to the South Gate road. The new
  Sorrel Way runs along y 920 past the main gate, and y 921 holds new plots.
- **East of the park is untouched.** The Box Office, Mulcahy's and the Cart Yard on x 898 already
  face the park and stay where they are.

## What moves

The 23 buildings inside the square go to `map_set_aside`, as the nine tiles the park first replaced
did ([hughson-coliseum.md §3](hughson-coliseum.md#3-what-was-set-aside)), and are re-sited, not
deleted:

| Group | Buildings | Goes to |
|---|---|---|
| The park's own trades | Pruitt's Peanuts & Pretzels, Fitz's Franks, Kimble's Souvenirs & Cards | The new Sorrel Way, either side of the main gate, as §10 had them either side of the old one |
| Civic | Coldwater Recital Hall, Halcyon Pavilion, The Winter Garden, Halcyon West Halt | New plots on y 921; the West Halt keeps its line, one stop further along |
| Houses | 1, 2, 7, 9, 11 Halcyon Boulevard; 1, 2, 6, 8, 10, 12, 15 Kerbstone Row; 1 and 4 Sorrel Way; 5 and 7 Vetch Mews | New plots on y 921 and the Rust Flats strip at x 886, keeping their names and their keepers |

Each moves with its zone, its furniture, its NPCs' homes and its keepers' vendor graph, and its
`flags.set_aside_from` records where it stood.

## The work

| Part | What changes | Where |
|---|---|---|
| Ground | The Curtain's west and south runs, the new tiles on the Rust Flats and below y 919, the glacis | content `zones`, `flags.curtain`; `npm run wildlands:bake` after the edge moves |
| Set-aside and re-siting | 23 buildings to `map_set_aside`, then onto new plots | a content script in the style of `hughson-parkside.mjs`; `scripts/content/sitecheck.mjs` before siting |
| The park | 121 tiles, their connections, the gates on the new streets | `scripts/content/hughson-coliseum.mjs`; `sports_pools.venue.site.block` (the script refuses to run if the two disagree) |
| GLASS | The `ballpark` arm drawing an 11 by 11 block instead of 3 by 3; 121 rows in the model registry; `TYPE_FLOORS` | `glass/models/coliseum.js`, `model-registry.js`. The arm already draws each tile's slice of block coordinates and clips at tile edges, so this is a bigger block, not a new technique |
| The broadcast | `B2T` and `ftUp` read the ruler; `parkOutline`, the street camera and `MAIN_U` re-placed | `diamond/geo.js`, `gl/ballpark-mesh.js`, `diamond/streets.js` |
| Unchanged | The Platinum Box and every stands section | They're in the field's feet, which don't move |
| Docs | The site, GLASS and TV sections; the infill's map; the trades table | `hughson-coliseum.md`, `halcyon-fields-infill.md` |

Gates: `content:lint`, `sitecheck`, `shapes:smoke` (every one of the 121 slices, night and day),
`imports:smoke`, and `test:regress`, which needs a database, so this is built at a desk.

## Phases

1. The ground: move the Curtain and lay the new tiles. Nothing else changes.
2. Set aside and re-site the 23 buildings, so the estate is whole before the park grows.
3. The park on 121 tiles, content and GLASS together, behind the same gate check the 3 by 3 had.
4. The broadcast onto the ruler.

## Open questions

- **The north side.** The square's top row, y 909, meets the Glasshouse's southern edge at y 908. A
  ballpark is usually an island with a street on every side; here the north wall would stand
  straight against the Glasshouse. Leave it, or take y 909 for a street and shift the park to
  y 910-920 (one more row of the south wall).
- **Sir Charles's ground.** It's deep right field now. Does the rotunda and his statue stay at the
  main gate, or does something mark his original lot?
- **The bleacher gate.** It opens north onto Halcyon Boulevard today. With the boulevard's west end
  inside the park, it moves to the west side on the river road, or to the north side if that gets a
  street.
