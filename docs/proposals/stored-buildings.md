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
