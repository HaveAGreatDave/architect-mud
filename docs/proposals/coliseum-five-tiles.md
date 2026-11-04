# The Coliseum at five tiles

> **Status: built 2026-11-04.** The park stands on 25 tiles at x 893-897, y 916-920, the south-east
> corner of Sir Charles's lot, and the other 96 tiles of the lot are open ground. The broadcast keeps
> the park at true size. [hughson-coliseum.md](hughson-coliseum.md) describes the park as it stands;
> this page is why it changed and what moved. It replaces the size decided in
> [coliseum-true-size.md](coliseum-true-size.md), whose Curtain, streets and re-sited buildings all stay.

## Why

At 11 by 11 the park was the one thing in Coldwater drawn at true size. Everything round it isn't:

| | Width | Against a tower |
|---|---|---|
| A Coldwater tower, measured off the baked shapes | about 14 m | |
| A real tower | 30 to 60 m | |
| A real stadium against a real tower | | about 4.7 across, 22 by ground area |
| The park at 11 tiles | 187 m | 13.1 across, 172 by ground area |
| **The park at 5 tiles** | **88 m** | **6.2 across, 38 by ground area** |

Coldwater's towers are real height and about a third of real width, so no one size matches both.
Against their width the true match is about 4 tiles; against their height the true-size dome was
right. Dave's call (2026-11-04) was the 5, with height in proportion: the wall 15 m, the towers 29 m,
the dome's crown 34 m and the beacon 41 m.

## The map and the broadcast

⚠ **They're no longer one size.** The plan still holds one set of numbers, in park units, but a unit
means two things:

- The map's arm reads `SH` (5/3 tiles) and `SV` (1.81 tiles).
- The broadcast reads `UNIT_FT` (208.5 ft) and `UP_FT` (226 ft) in `diamond/geo.js` and
  `gl/ballpark-mesh.js`, so the park on TV didn't change. A game still needs a real field.

Neither side reads the other's. This brings back the map-only stretch the true-size build removed,
and it's the same thing the nine-tile park did: `BLOCK / SH` is three park units, as it was then, so
every gap in the bowl and at the gates is one the arm was first drawn to.

The TV's city already copes with a block smaller than the park: `composeSet`'s warp pushes everything
out from the block's edge to the full outline.

⚠ **A wall counts from the block, not from home plate** (`skylineFrom`). Home plate went to 919.6, and
the south wall's run on row 919 east of the South Gate then counted as north of it, which cut the
TV's city to five rows deep.

## The lot

```
          x 887 . . . . 892 . . . . 897
    y 910   G G G G G G G G G G  r        G  Hughson Green (50)
          . G G G G G G G G G G  r        r  Hughson Way (21)
          . G G G G G G G G G G  r        c  the Hughson Car Park (25)
          . G G G G G G G G G G  r        P  the park (25)
          . G G G G G G G G G G  r
    y 915   r r r r r r r r r r  r
          . c c c c c r P P P P  P
          . c c c c c r P P P P  P
          . c c c c c r P P P P  P
          . c c c c c r P P P P  P
    y 920   c c c c c r P P P P  P
```

- **The south-east corner, not the middle.** Home plate stays in the corner of the lot, the main gate
  stays on Sorrel Way, and Fitz's Franks at 896,922 is at last straight across from it, as its prose
  always said. In the middle of the lot no gate would have met a street.
- **Every id stays.** A tile that was a slice of the park keeps `zone_ballpark_<x>_<y>` and takes a new
  role, so no zone file went and nothing that names one is orphaned. The ground's `power_zones` rows
  stay too.
- **Hughson Way** is an L and a spur: along y 915 from the river road to x 897, down x 892 to Sorrel
  Way, and up x 897 to Halcyon Boulevard. It carries the bleacher gate and GATE D, and the Cart Yard
  opens onto it.
- **Hughson Green** is plain grass, the lot as Halcyon never got it. **The car park** is the generic
  `car_park` arm on 25 tiles, all facing east to Hughson Way.
- The 23 buildings moved for the true-size park stay on their new plots, and the 112 tiles set aside
  for it stay on `map_set_aside`.

## The gates

| Tile | Type | Door | Street |
|---|---|---|---|
| 896,920 | `ballpark` | the main gate, south (`HC`) | Sorrel Way, across from Fitz's Franks |
| 893,916 | `ballpark_bleachers` | the bleacher gate, north (`BG`) | Hughson Way |
| 897,916 | `ballpark_gate_c` | GATE C, east (`G3`) | the end of Kerbstone Row |
| 893,917 | `ballpark_gate_d` | GATE D, west (`G4`) | Hughson Way, across from the car park |

⚠ **A gate is drawn where its park units fall and a door is the tile `DOORS` names.** `ballpark-smoke`
holds the two together. GATE C's `v` moved from -0.843 to -1.1025 so it would face Kerbstone Row and
not the tower at 898,917, and that moves it along the east face on TV too. GATE D's didn't move, so
the 17 openings on TV are as they were.

## Running it again

[scripts/content/coliseum-five.mjs](../../scripts/content/coliseum-five.mjs) wrote the content and
refuses to run twice. It removed 214 connection files: the walls round the old slices and the doors'
links.

⚠ **Those rows outlive their files until the deletion is committed**, because the import's deletion
pass works from git. On a database that hasn't had the commit, the old walls still stand on the lot.
`scripts/content/coliseum-park.mjs` and `hughson-coliseum.mjs` are history now: both refuse to run.

After the content, `node scripts/snapshot-flight-world.mjs`, `npm run shapes:bake` and
`npm run wildlands:bake`.

## What isn't done

- **The name band** was cut on Sorrel Way and Halcyon Boulevard. It's on the same faces, but the north
  face now looks onto Hughson Way.
- **The lot in the text.** Nothing happens on the green or in the car park on a game night yet: no
  crowd, no attendant and no parked-up rush.
- **A taller dome** was rendered as an idea and not chosen. `SV` is the one number if it comes back.
