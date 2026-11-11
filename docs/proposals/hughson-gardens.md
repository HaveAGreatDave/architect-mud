# Hughson Gardens and Grandstand Plaza *(as built)*

**Status: BUILT 2026-11-09, on the map.** The run of Hughson Way under the Coliseum's south wall is
Grandstand Plaza, paved for the crowd, and the four buildings on the row in front of it are Hughson
Gardens: a pergola walk, a parterre and two fountains either side of Grandstand Walk.
[scripts/content/hughson-gardens.mjs](../../scripts/content/hughson-gardens.mjs) wrote the content and
refuses to run twice. The dressings are [glass/park-formal.js](../../client/game/js/panels/glass/park-formal.js).

## Why

Dave's call (2026-11-09): the main gate looked out over a road and the backs of three buildings, so
the ground in front of it should be part of the park's design, with the road in front of the gate
given over to people on foot.

## The map

```
        890 891 892 893 894 895 896 897
 y 918   E   P   P   P  HC   P   R   T
 y 919   T   F   F   F   F   F   R   T
 y 920   T  g1  g2  g3   w  g4   R   T
 y 921  ===== Sorrel Way ==============
```

`P` is the park and `HC` its main gate. `F` is Grandstand Plaza, `w` Grandstand Walk, `R` Hughson Way
and `T` a sealed tower.

| Tile | Zone | Name | Dressing |
|---|---|---|---|
| 891..895,919 | the five old Hughson Way tiles | Grandstand Plaza | `forecourt` |
| 894,920 | `zone_ballpark_892_914` | Grandstand Walk | `forecourt` |
| 891,920 | `zone_ballpark_893_912` | Hughson Gardens | `pergola`, north to south from Sorrel Way to the plaza |
| 892,920 | `zone_ballpark_893_913` | Hughson Gardens | `parterre` |
| 893,920 | `zone_ballpark_896_911` | Hughson Gardens | `fountain` |
| 895,920 | `zone_ballpark_896_913` | Hughson Gardens | `fountain` |

- **All ten are `park` terrain**, so they're the `park` biome and draw through `drawParkTile`. Every
  one carries `park_focus: { x: 894, y: 918.5 }`, the threshold of the main gate.
- **The plaza has no traffic.** It's not road terrain any more, so nothing drives it. Hughson Way
  comes down x 896 to Sorrel Way as before and stops at the plaza's east end.
- **The walk keeps its name** and its line: main gate, walk, Sorrel Way and Fitz's Franks are still
  one straight line south.

## What went

Nothing was deleted. Each building went to the holding map and a Hughson Green tile that had waited
there since [hughson-estate.md](hughson-estate.md) came back to take its plot, as the estate's moves were done.

| Building | Was at | Holding cell | Keeper |
|---|---|---|---|
| 19 Hughson Way, a sealed ten-storey tower | 891,920 | 1,23 | none |
| 3 Sorrel Way | 892,920 | 3,23 | none |
| 5 Sorrel Way | 893,920 | 5,23 | Nadia Ferreira, set aside |
| 7 Sorrel Way | 895,920 | 7,23 | none |

- The three facades keep their rooms, power rows, generators and models. Their street links
  (`conn_hf_district_895_913_south` and the 896 and 897 ones) were removed and each `world_exit_zone`
  names the facade itself.
- The tower's three walls went, and 16 Yarrow Lane got a new one on its east side.
- Run `scripts\oneshots.bat prod` after the deploy: `set-aside-players.mjs` moves anybody left in the
  three buildings' rooms.
- ⚠ **The six connection rows outlive their files until the deletion is committed**, because the
  import's deletion pass works from git. They were deleted from the local database by hand.

## The dressings

The four are generic park features, in the tag catalog with the other five. A forecourt is the only
one that reads `park_focus`; the server sends it as `pfo`, the focus from the tile's centre in tiles
(`parkFocus` in `plugins/flight/state.js`).

- **`forecourt`**: limestone flags, with granite rings and paler rays laid round the focus and a bronze
  half-sun with gilt rays at the door. Deco lamp standards in a row, benches facing the door, a pair of
  planters at the walk's mouth, banner poles down both sides of the walk and bollards across its far end.
  Each of those is placed in the focus's frame and repeats outward, and each tile draws the part that
  lands on it, clipped to its square, so five tiles read as one sunburst.
- **`fountain`**: an octagonal limestone basin on a step, two tiers with water in them, a gilt sun
  finial, sheets off each tier and eight jets arching in from the rim. The jets are lit after dark.
  Yew cones in planters at the corners and two benches facing the water.
- **`parterre`**: four beds edged in box, each with three hedges fanned out from its inner corner and
  red, white and gold bedding between them, round a gilt-tipped obelisk on a stepped plinth.
- **`pergola`**: limestone piers and timber running north to south, wisteria on top hanging through,
  benches under it, lavender along the walk and trees on the lawns either side.

`scripts/shapes/park.mjs` holds all nine dressings to their tiles.

## What isn't done

- **TV.** The broadcast's park stands on its own ground with the main gate on Sorrel Way
  ([coliseum-five-tiles.md](coliseum-five-tiles.md)), so the gardens and plaza aren't on its set.
- **The minimap** shows the plaza as park green, not paving.
- **Game nights** don't fill the plaza with a crowd yet.
