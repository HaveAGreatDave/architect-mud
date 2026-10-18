# Stored buildings

A stored building has a complete interior and a GLASS model in `content/` but no world tile. Its
rooms exist and its NPCs exist, but there's no way in. Nothing gets deleted, so you can put one back
without rebuilding it.

## Lather & Lye (stored 2026-10-08)

The barber's and bathhouse that stood on Marrow Street at 916,908. It gave its tile to Nico's Noodle
Bar, which moved one tile west so that 917,908 could become road (Lever Lane now runs south to
Marrow Street).

What's kept:

- Rooms: `zone_soak_front` (barber floor), `zone_soak_baths`, `zone_util_zone_soak_front`, all on
  `map_int_soak`, with their furniture, lights, junction box and generator.
- Model: `content/building_models/latherlye.json`, bound by name to `Lather & Lye`.
- Barber: `npc_soak_barber` (Nessa Marrit). She still lives in Meridian 403 and still stocks the
  shop, but her `work_zone_id` is `null`, so she spends shift hours off work instead of trying to walk
  to a door that isn't there.

What was taken out, and what you need to put back when you re-site it:

1. A facade tile with `name`/`flags.building_name` `Lather & Lye`, `building_type: bathhouse`,
   `sign_trade: BARBER`, an `entrance`, `facade: true`, `is_building: true`, a `world_exit_zone`,
   and the barber's-pole description (it's in git at `content/zones/zone_district_916_908.json`
   before this change). Run `node scripts/content/sitecheck.mjs` first.
2. `map_int_soak.parent_zone_id`, plus `parent_zone` on the three rooms and
   `flags.world_exit_zone` on `zone_soak_front`, all set to that tile.
3. An exit from `zone_soak_front` back out to the tile, in the facade's entrance direction
   (never `out`), and a connection plus shop-lock door like the deleted
   `conn_district_916_908_north_2k6w` and `door_basic_zone_district_916_908_in`.
4. `npc_soak_barber.work_zone_id` set back to `zone_soak_front`.
5. A map icon for the tile, if the new site's quarter needs one.

## The holding map (2026-10-18)

A second way to store a building keeps its tile. The Charles B. Hughson Coliseum took nine tiles of
Halcyon Fields, and the six buildings and the green on them moved, tiles and all, onto
`map_set_aside`, a map of their own that nothing on the world connects to. Each keeps its facade,
so its door, its map code and its model come back with it, and its keepers carry `flags.set_aside`,
which the game loop reads to pause them in their rooms. How it was done and how to put one back are
in [hughson-coliseum.md](hughson-coliseum.md#3-what-was-set-aside). Reach for it when a whole block
goes, and for the route above when one building gives up its tile to another.

## Skeleton Crew, Rest Assured and Corner the Market (set aside 2026-10-18)

Three Filaments buildings on the Glasshouse's edge, taken out because they butted up against the
Halcyon Boulevard towers and looked out of place. They wait on the holding map until the
Filaments-to-Glasshouse transition along Kettle Green is designed.
[scripts/content/set-aside-kettle-three.mjs](../../scripts/content/set-aside-kettle-three.mjs) did it.

| Was at | Building | Holding grid | Keeper |
|---|---|---|---|
| 898,905 | Skeleton Crew | 1,5 | Rufus Bandy, set aside |
| 900,905 | Rest Assured | 3,5 | Dilys Trantham, set aside |
| 897,907 | Corner the Market | 5,5 | Basil Quennell: lives in the Filament Buildings, so his `work_zone_id` is `null` instead |

- Each facade keeps its id and moved whole, as the Coliseum's did. With no street on the holding
  map, its `world_exit_zone` names itself.
- Each plot is grass now, `zone_kettle_<x>_<y>`, named Kettle Green, joined both ways to every open
  neighbour, with a `power_zones` row copied from the facade's.
- The one street connection file, `conn_district_898_905_south_nqax`, was removed.
- Run `scripts\oneshots.bat prod` after the deploy: `set-aside-players.mjs` converges, so it moves
  anyone left in these rooms and lists any rented room at Rest Assured.

To put one back, follow the Coliseum's steps, and delete or reuse the `zone_kettle_` tile on its plot.
