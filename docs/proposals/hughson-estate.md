# The Hughson estate *(as built)*

**Status: BUILT 2026-11-04.** The eleven Halcyon buildings waiting on the holding map stand on the
Coliseum's lot again, Hughson Way runs through it from Halcyon Boulevard to Sorrel Way, and the
grass round the park is kept parkland. [scripts/content/hughson-estate.mjs](../../scripts/content/hughson-estate.mjs)
wrote the content and refuses to run twice.

⚠ **The green is gone.** Later the same day the green and the car park were built over
([hughson-towers.md](hughson-towers.md)). The eleven buildings stand as described here, and the green's
sections below are what was there.

⚠ **The road moved.** When the park went two tiles west
([coliseum-five-tiles.md](coliseum-five-tiles.md#two-tiles-west)) x 892 came to stop at the junction on
y 915, and Hughson Way reaches Sorrel Way down x 896 instead. 2 Halcyon Boulevard and Fitz's Franks
swapped plots on Sorrel Way. On 2026-11-09 2 Halcyon Boulevard left Sorrel Way for the River Road
([hughson-towers.md](hughson-towers.md#2-halcyon-boulevard)), and Kimble's took its plot.

⚠ **Three buildings moved again.** When the park went two tiles north
([coliseum-five-tiles.md](coliseum-five-tiles.md#two-tiles-north)) it took their plots, so 3, 5 and 7 went to
892,920, 893,920 and 895,920 with their south doors on Sorrel Way, and took their Sorrel Way addresses
back. On 2026-11-09 those three went to the holding map for Hughson Gardens ([hughson-gardens.md](hughson-gardens.md)). The tables below are as they stood then, and the map is what was built. y 915 east of x 890 is gone.

## Why

When the park came down to five tiles ([coliseum-five-tiles.md](coliseum-five-tiles.md)) it left 50
tiles of blank grass north of it and more gaps along Sorrel Way, and eleven enterable buildings with
their keepers were still paused on `map_set_aside`.

## The map

```
        887 888 889 890 891 892 893 894 895 896 897
 y 909  ===== Halcyon Boulevard ==================
 y 910   g   g   g   g   f   R  6HB 8HB INS LND  r
 y 911   g   g   b   g   f   R   f   b   f  9HW  r
 y 912   g   b  PND  b   f   R  2HW  f   b   f   r
 y 913   g   g   b   g   f   R  SS   b   f 11HW  r
 y 914   b   b   b   b   b   R  3HW 5HW 7HW  b   r
 y 915  ===== Hughson Way ========================
```

`g` grove, `f` flowerbeds, `b` benches, `PND` the pond, all named Hughson Green. `R` is the new road
and `r` the old spur on x 897, both Hughson Way.

## What moved

| Building | Plot | Door | Street | Keeper | Holding cell |
|---|---|---|---|---|---|
| 6 Halcyon Boulevard | 893,910 | north | Halcyon Boulevard | Montague Fewtrell | 1,9 |
| 8 Halcyon Boulevard | 894,910 | north | Halcyon Boulevard | Dorothea Crake | 1,1 |
| The Halcyon Institute | 895,910 | north | Halcyon Boulevard | Clement Quainton | 2,1 |
| Halcyon Land Office | 896,910 | north | Halcyon Boulevard | Merrick Follet | 3,1 |
| 2 Hughson Way | 893,912 | west | Hughson Way | none | 3,9 |
| Halcyon Sales Suite | 893,913 | west | Hughson Way | Lavinia Fairlie | 5,9 |
| 3 Sorrel Way | 892,920 | south | Sorrel Way | none | 1,3 |
| 5 Sorrel Way | 893,920 | south | Sorrel Way | Nadia Ferreira | 2,3 |
| 7 Sorrel Way | 895,920 | south | Sorrel Way | none | 3,3 |
| 9 Hughson Way | 896,911 | east | Hughson Way | Adaeze Okonjo | 7,9 |
| 11 Hughson Way | 896,913 | east | Hughson Way | Ottilie Marchbank | 9,9 |

- **Every building kept its entrance.** `flags.entrance` is the side its model draws the door on, and
  the rooms behind it are laid out from it, so each went to a plot with a road on that side.
- **A move is a swap.** The building took the plot's grid and `map_id`, and the green tile on the plot
  took the building's old holding cell, with `flags.set_aside` and `flags.set_aside_from`. No zone file
  was created or deleted, and every `power_zones` row stayed with its zone.
- **The street links came back under their old ids**, `conn_hf_district_<x>_<y>_<dir>`, which name the
  tile each building stood on before the Coliseum. They were deleted when the buildings were set aside.
- ⚠ **The displaced tiles have a few exits.** On rows 1 and 3 the holding map is contiguous, so they
  join each other and Vetch Green. content:lint holds `exits` to the grid, and those tiles aren't
  facades, so the grid projects them. Nothing there reaches the world.

## The green

The west lawn is 25 tiles with the pond in the middle at 889,912, groves toward the north and west
edges, flowerbeds down x 891 beside the road and benches along Hughson Way. The courtyard behind the
buildings is nine tiles of flowerbeds and benches. It opens off the road at 893,911, and also off the
x 897 spur at 896,912. 896,914 is a corner on its own, open to the two roads.

A park tile is `flags.terrain: park` with a `park_feature`, as Fisherman's Green is. That's what makes
it the `park` biome in GLASS (`drawParkTile`, `parkSolidsGL`), and `park_feature` chooses the dressing.

Ten grass gaps took the same dressing and kept their ids. Nine are Sorrel Gardens: 887, 889, 891, 893,
895 and 897 on y 922, and 901, 903 and 905 on y 920. 898,919 is Windrow Corner. The y 923 strip and
x 885 are still meadow.

⚠ **903,920 and 898,919 each have a wall file.** sitecheck warns "referenced by connections".
`conn_district_895_917_south_dx29` walls 903,920 from the sealed shell of 8 Kerbstone Row, and
`conn_ballpark_891_919_east_8e06` walls 898,919 from 25 Hughson Way. Neither wall stops the tile being a
garden, and both stay.

## The renames

An address has to be true, so a building on Hughson Way has a Hughson Way number.

| Was | Is | Map code | Why the number |
|---|---|---|---|
| 8 Vetch Mews | 2 Hughson Way | `V8` to `2W` | the even side of the x 892 road |
| 1 Kettle Lane | 9 Hughson Way | `L1` to `9W` | next in order round the corner |
| 5 Kettle Lane | 11 Hughson Way | `K5` to `1W` | next in order round the corner |

3, 5 and 7 Sorrel Way were 3, 5 and 7 Hughson Way for a day, as `W3`, `W5` and `W7`, and went back with
their doors ([scripts/content/coliseum-north.mjs](../../scripts/content/coliseum-north.mjs)). They're
`W3`, `S5` and `S7` again. The Halcyon Boulevard addresses still stand on the boulevard, and the Institute, the Land Office and
the Sales Suite have no number to change. No puns: this is Halcyon Fields.

- The name changed on the facade, every room, each interior map, the keepers' `vendor_shop_name`, the
  `power_zones` rows and the generators. A room's name keeps the dash that every building's rooms have.
- ⚠ **5 and 7 are bound to their models by name.** `NAMED_MODELS` in
  [model-registry.js](../../client/game/js/panels/glass/model-registry.js) and the files in
  `content/building_models/` are keyed `5sorrelway` and `7sorrelway`, so a change of address needs
  `npm run models:bake`. The other four draw by type and needed nothing.
- The pump room at 11 dropped the "The" from its name because the longer address took it to 30
  characters, where docs:prose starts counting the dash in a name.
- Docs that say where something stood keep the old name.

## The story

Sir Charles owned the ground and wouldn't sell it, and Halcyon built its estate round him
([hughson-coliseum.md](hughson-coliseum.md#1-sir-charles)). The buildings stand on the estate's edge of
the lot and nothing says he sold them the plots. The green is his. 889,911 tells the cheques, 889,912 has
a plate on the pond, and the mowing still comes out of the gate money.

Lines that changed because they stopped being true:

- Vetch Green and its birches, seen from 5 and 7 Hughson Way, are Hughson Green and its flowerbeds now.
- 11 Hughson Way looked south over meadow to the Curtain. It looks over the green at the Coliseum.
- Ottilie Marchbank's land office story was the plot next door, which is the green now. It's a plot off
  Kettle Lane.
- Adaeze Okonjo shared a main with a glasshouse that moved. She's on the Kettle Lane main with the rest
  of the street.
- Mulcahy's window, and the three Sorrel Way tiles that had "nothing much" on them.

## After the deploy

- `scripts\oneshots.bat prod`: `set-aside-players.mjs` moves anyone left standing on the eleven displaced
  green tiles to the rotunda.
- `node scripts/snapshot-flight-world.mjs`, `npm run shapes:bake` and `npm run wildlands:bake`. Until
  the shapes bake runs, `building-shapes.js` and `building-lights.js` still key 5 and 7 by their old
  slugs.

## What isn't done

- **The courtyard's birches.** Vetch Green stays on the holding map, with no plot to go to.
- **A game night on the green.** The prose mentions blankets, and nothing happens yet.
