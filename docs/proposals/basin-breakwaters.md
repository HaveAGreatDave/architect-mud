# The Basin breakwaters

**Status: as built.**

Two rubble moles across the north of the Coldwater Basin, so the water between Fairweather Marina and
the Eastern Marina, and the river mouth west of it, lies calm. The tiles are written by
[scripts/content/breakwaters.mjs](../../scripts/content/breakwaters.mjs).

| Mole | Tiles | Ends |
|---|---|---|
| West Mole | 878,898..900, the knuckle at 878,897, then 879..895 on row 897 | Ashore at 878,901; green light at 895,897 |
| East Mole | 900..925 on row 897 | Red light at 900,897; ashore on the runway's end at 925,898 |

The mouth, 896..899 on row 897, is open water. The Echelon moors at 897,898 and goes out through it.

## How it makes the water calm

No new code does it. The tiles were open water and are now `terrain: concrete`, which GLASS reads as
land. `shelterFill` (windshield.js) looks upwind from every water tile for land and flattens the sea
behind it, both the drawn water and what a hull rides. So the moles calm the harbour against any
wind with north in it. A westerly still runs down the coast; the city already blocks a southerly.

Each tile keeps its id and its exits, so a swimmer can climb out onto a mole or go in off the side.
The moles are walkable from both shore ends and carry `fishing_table_id: fish_coldwater_bay`.

## The models

`breakwater` (a run) and `breakwater_head` (a head or the knuckle) are arms in
[glass/models/waterfront.js](../../client/game/js/panels/glass/models/waterfront.js). A section is
unseeded and symmetric, like the landing stage, and runs along the way `entrance` points. The
building types `breakwater_head_red` and `breakwater_head_green` set the light's colour through
`neon`. `breakwater_knuckle` has none, so it carries no light. Like a pontoon, a mole is a standable
deck rather than a facade, so it gets no map icon.

## Knock-ons

- The seabed model (`client/shared/seabed.js`) takes depth and floor from distance to land, so it
  reads the moles as a coast: the water north of them is shallower and sandier than before. The
  only ashen pike in reach of the harbour lived on a wreck at 879,888 that went from silt to sand, so
  the pike now takes a sandy floor at weight 0.2 (`client/shared/fish.js`).
- The wildlands field was rebaked for the new coast (`npm run wildlands:bake`).
