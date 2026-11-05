# The Coliseum at five tiles

> **Status: built 2026-11-04.** The park stands on 25 tiles at x 891-895, y 914-918, two tiles in from
> the south and east edges of Sir Charles's lot ([Two tiles west](#two-tiles-west),
> [Two tiles north](#two-tiles-north)), and the rest of the lot is the car park, Hughson Way, and since later that day the estate and the green
> ([hughson-estate.md](hughson-estate.md)). The green and the car
> park are towers now ([hughson-towers.md](hughson-towers.md)). The broadcast keeps
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
the roof's crown 28 m and the beacon 35 m.

## The map and the broadcast

⚠ **They're no longer one size.** The plan still holds one set of numbers, in park units, but a unit
means two things:

- The map's arm reads `SH` (5/3 tiles) and `SV` (1.81 tiles).
- The broadcast reads `UNIT_FT` (208.5 ft) and `UP_FT` (226 ft) in `diamond/geo.js` and
  `gl/ballpark-mesh.js`, so the park on TV didn't change. A game still needs a real field.

Neither side reads the other's. This brings back the map-only stretch the true-size build removed,
and it's the same thing the nine-tile park did: `BLOCK / SH` is three park units, as it was then, so
every gap in the bowl and at the gates is one the arm was first drawn to.

⚠ **The TV's city isn't composed round the five tiles.** `composeSet`'s warp can push everything out
from a small block's edge to the full outline, and that's what it did at first, but it stood the
Halcyon towers eight tiles back and the field lost them. The venue's `site.set` names the whole lot and
the true-size home plate, so the city stands where it stood at 11 tiles.

⚠ **A wall counts from the block, not from home plate** (`skylineFrom`). Home plate went to 919.6, and
the south wall's run on row 919 east of the South Gate then counted as north of it, which cut the
TV's city to five rows deep.

## The lot

This is the lot as it was first built, with the park in the corner. [Two tiles north](#two-tiles-north)
has where it stands now.

```
          x 887 . . . . 892 . . . . 897
    y 910   G G G G G r B B B B  r        G  Hughson Green (34)
          . G G G G G r G G G B  r        B  Halcyon's buildings (11)
          . G G G G G r B G G G  r        r  Hughson Way (26)
          . G G G G G r B G G B  r        c  the Hughson Car Park (25)
          . G G G G G r B B B G  r        P  the park (25)
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
- **Hughson Way** runs along y 915 from the river road to x 897, straight up x 892 from Sorrel Way to
  Halcyon Boulevard, and up x 897 to the boulevard. It carries the bleacher gate and GATE D, nine of
  the buildings' doors, and the Cart Yard opens onto it.
- **Hughson Green** is kept parkland, a west lawn and a courtyard behind the buildings, and the
  buildings are the eleven Halcyon buildings the park and its trades had set aside. Both came a few
  hours after this page was first written: [hughson-estate.md](hughson-estate.md). **The car park** is
  the generic `car_park` arm on 25 tiles, all facing east to Hughson Way.
- The 23 buildings moved for the true-size park stay on their new plots, and the 112 tiles set aside
  for it stay on `map_set_aside`.

## The gates

| Tile | Type | Door | Street |
|---|---|---|---|
| 894,918 | `ballpark` | the main gate, south (`HC`) | Hughson Way at 894,919, with Grandstand Walk on to Sorrel Way |
| 891,914 | `ballpark_bleachers` | the bleacher gate, north (`BG`) | the short cut off Hughson Way at 891,913 |
| 895,914 | `ballpark_gate_c` | GATE C, east (`G3`) | Hughson Way at 896,914 |
| 891,915 | `ballpark_gate_d` | GATE D, west (`G4`) | Hughson Way at 890,915 |

⚠ **A gate is drawn where its park units fall and a door is the tile `DOORS` names.** `ballpark-smoke`
holds the two together. GATE C's `v` moved from -0.843 to -1.1025 so it would face Kerbstone Row and
not the tower beside it, and that moves it along the east face on TV too. GATE D's didn't move, so
the 17 openings on TV are as they were.

## Two tiles west

Later on 2026-11-04 the map's park moved from x 893-897 to x 891-895, on the same rows.
[scripts/content/coliseum-west.mjs](../../scripts/content/coliseum-west.mjs) wrote it and refuses to
run twice.

**Why.** The broadcast's park stands on the whole lot with home plate at 894.86,917.86, and the map's
park is that park scaled about home plate. In the corner of the lot the map's home plate was at
896.61,919.61, so Halcyon Towers stood 8 degrees off where the field sees it on TV. Home plate is at
894.61,919.61 now.

| Bearing from home plate | TV | Park at x 893 | Park at x 891 |
|---|---|---|---|
| Halcyon Towers, 895,906 | 3.2 | 355.2, 8.0 off | 3.9, 0.7 off |
| The Spire, 892,906 | 348.3 | 342.6, 5.7 off | 350.9, 2.6 off |
| 11 Halcyon Boulevard, 891,908 | 340.3 | 335.3, 5.0 off | 344.4, 4.1 off |
| 1 Halcyon Boulevard, 887,908 | 321.8 | 320.6, 1.2 off | 327.4, 5.6 off |

⚠ **It's a trade.** The towers north of the field came on and the ones to the north-west went off, and
over the eight tallest the mean is 3.7 degrees either way. The map's home plate is still 1.75 tiles
south of TV's, and only x moved.

**TV didn't move.** `site.set` is TV's own ground, so the broadcast's park, its city and its camera
are as they were. Only `site.block`, `site.x` and `site.y` follow the map. The tiles keep their
`bc`/`br` types and everything GLASS draws is block-relative, so no client code changed.

Where it stood after this move, before [Two tiles north](#two-tiles-north):

```
        889 890 891 892 893 894 895 896 897 898
 y 915  ===== Hughson Way ====================  17
 y 916   Y   T  BG   P   P   P  G3   R   K   K
 y 917   Y   E  G4   P   P   P   P   R   T  14
 y 918   +   E   P   P   P   P   P   R   T   W
 y 919   Y   T   P   P   P   P   P   R   T   g
 y 920   Y   T   P   P   P  HC   P   R   T  KM
 y 921  ===== Sorrel Way =====================
 y 922   g  HA   g  S4   g  FK   g  B2   g   .
```

`P` is the park, with its four gates by map code. `T` is a sealed tower, `Y` Yarrow Lane, `E` Teasel
Walk, `R` Hughson Way, `K` Kerbstone Row and `W` Windrow Lane.

- **Every id stays**, and `zone_ballpark_<x>_<y>` names an old cell, so find a tile by its grid. The
  main gate is `zone_ballpark_896_920` at 894,920.
- **Hughson Way** used to run down x 892 beside the park. Those five tiles are on x 896 now, so the road
  comes down the park's east side from y 915 to Sorrel Way. x 892 stops at the junction on y 915.
- **Kerbstone Row** runs on two tiles to Hughson Way. 897,916 was the east end of Teasel Walk, and GATE C
  is straight across from it.
- **The four towers on x 891** moved to x 897 in order. They're still 21, 23, 25 and 27 Hughson Way, on the
  odd side, and each now has its entrance on the west.
- **12 Yarrow Lane came down**, which leaves 40 sealed towers. GATE D's door needs a street, so 890,917
  is road. It's named Teasel Walk because that's what it joins: the walk comes east along y 918, stops
  at the park's wall and turns north to the gate. It also opens west onto Yarrow Lane.
- **Fitz's Franks and 2 Halcyon Boulevard swapped plots**, so Fitz's at 894,922 is straight across Sorrel
  Way from the main gate, and 2 Halcyon Boulevard is at 896,922.
- **A wall follows its tiles.** 27 walls went and 24 were minted. 897,915 and 897,916 are open road,
  so the corner of Hughson Way and Kerbstone Row is four road tiles.

## Two tiles north

The same day the park moved again, from y 916-920 to y 914-918 on the same columns.
[scripts/content/coliseum-north.mjs](../../scripts/content/coliseum-north.mjs) wrote it and refuses to
run twice.

**Why.** The move west left the map's home plate 1.75 tiles south of TV's. It's at 894.61,917.61 now, a
quarter tile from the broadcast's 894.86,917.86, so everything the field looks at stands where TV has it.

| Bearing from home plate | TV | Park at 891,916 | Park at 891,914 |
|---|---|---|---|
| 1 Halcyon Boulevard, 887,908 | 321.8 | 327.4, 5.6 off | 322.0, 0.2 off |
| 7 Halcyon Boulevard, 888,908 | 325.8 | 331.2, 5.4 off | 326.2, 0.3 off |
| 5 Vetch Mews, 888,906 | 330.8 | 335.0, 4.3 off | 331.2, 0.4 off |
| 7 Vetch Mews, 888,905 | 332.8 | 336.6, 3.8 off | 333.2, 0.5 off |
| 1 Sorrel Way, 888,904 | 334.5 | 338.0, 3.4 off | 335.0, 0.5 off |
| 11 Halcyon Boulevard, 891,908 | 340.3 | 344.4, 4.1 off | 341.2, 0.9 off |
| The Spire, 892,906 | 348.3 | 350.9, 2.6 off | 349.2, 1.0 off |
| Halcyon Towers, 895,906 | 3.2 | 3.9, 0.7 off | 4.6, 1.4 off |

Over those eight, the eight tallest in reach, the mean goes from 3.7 degrees off to 0.6. It was 3.7 before
the move west too. Halcyon Towers is the one that slipped, by 0.7 degrees. Bearings are from tile
centres.

**TV didn't move.** `site.set` is unchanged, so TV still stands the main gate on Sorrel Way. Only
`site.block` and `site.y` follow the map. The Guardians, the plates and the name band are as they were:
the map's bowl is block-relative, so the south face is on Hughson Way now and still carries them.

```
        889 890 891 892 893 894 895 896 897 898
 y 912   +   B   B   +  2HW  c   c   c   r
 y 913   Y   T   a   R  SS   c   c  11HW r
 y 914   Y   T  BG   P   P   P  G3   R   r
 y 915   +   R  G4   P   P   P   P   R   r  17
 y 916   Y   T   P   P   P   P   P   R   K   K
 y 917   Y   e   P   P   P   P   P   R   T  14
 y 918   +   E   P   P   P  HC   P   R   T   W
 y 919   Y   T   R   R   R   R   R   R   T   g
 y 920   Y   T   T  S3  S5   w  S7   R   T  KM
 y 921  ===== Sorrel Way =====================
 y 922   g  HA   g  S4   g  FK   g  B2   g   .
```

`P` is the park, with its four gates by map code. `T` is a sealed tower, `c` Hughson Court, `R` Hughson
Way, `a` its short cut to the bleacher gate, `Y` Yarrow Lane, `B` Burnet Walk, `E` and `e` Teasel Walk, `K`
Kerbstone Row, `W` Windrow Lane and `w` Grandstand Walk.

The ten tiles displaced on the north side went into the ten vacated on the south. Every id stays.

- **Hughson Way along the south wall.** The five road tiles from x 891-895 on y 915 are on y 919, in the
  same order. The run joins x 896 and stops at the side of 14 Yarrow Lane at the west end.
- **Grandstand Walk** is the old 892,914, now 894,920. The main gate, 894,919, the walk, Sorrel Way and
  Fitz's Franks are one straight line south, so Fitz's prose stays true.
- **19 Hughson Way** moved from 891,914 to 891,920, with its entrance on the north, on the new run.
- **3, 5 and 7 Hughson Way** moved to 892,920, 893,920 and 895,920. Their south doors open on Sorrel Way
  now, so they're 3, 5 and 7 Sorrel Way again ([hughson-estate.md](hughson-estate.md#the-renames)).
- **Two towers came down**, which leaves 38. 17 Hughson Way at 891,913 is the short cut to the bleacher
  gate, named Hughson Way and open to Burnet Walk as well. 9 Hughson Court at 896,914 is the road outside
  GATE C, open to x 897 as well as x 896, so that corner is four road tiles too.
- ⚠ **The lot is two halves on foot.** Hughson Way's old run through the block is gone, so x 892 and the
  lanes west of it meet x 896 and x 897 only by Halcyon Boulevard and Sorrel Way. It's still one piece,
  but from 892,913 the main gate is about 20 steps away.
- **Teasel Walk's yard** at 890,917 and the walk's end at 890,918 serve no gate now. Both stay walkable and
  keep the name, and GATE D is on Hughson Way at 890,915.
- **A wall follows its tiles.** 22 walls went and 17 were minted.

## Running it again

[scripts/content/coliseum-five.mjs](../../scripts/content/coliseum-five.mjs) wrote the content and
refuses to run twice. It removed 214 connection files: the walls round the old slices and the doors'
links.

⚠ **Those rows outlive their files until the deletion is committed**, because the import's deletion
pass works from git. On a database that hasn't had the commit, the old walls still stand on the lot.
`scripts/content/coliseum-park.mjs` and `hughson-coliseum.mjs` are history now: both refuse to run.

⚠ **A wall file that was never committed keeps its row for ever**, because git has no deletion to
report. coliseum-west.mjs removed 14 of those and coliseum-north.mjs 22, and their rows were deleted from
the local database by hand. Six of them stood across open streets. On any other database that imported
the uncommitted walls, do the same. The other 13 go with the commit.

After the content, `node scripts/snapshot-flight-world.mjs`, `npm run shapes:bake` and
`npm run wildlands:bake`.

## What isn't done

- **The name band** was cut on Sorrel Way and Halcyon Boulevard. It's on the same faces, but the north
  face now looks onto Hughson Way.
- **The lot in the text.** Nothing happens on the lot's streets on a game night yet: no
  crowd, no attendant and no parked-up rush.
- **A taller roof** was rendered as an idea and not chosen. `SV` is the one number if it comes back.
