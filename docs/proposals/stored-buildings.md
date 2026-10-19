# Stored buildings

A stored building has a complete interior and a GLASS model in `content/` but no world tile. Its
rooms exist and its NPCs exist, but there's no way in. Nothing gets deleted, so you can put one back
without rebuilding it.

## The register

Every building that's stored, so they can be looked at again and either re-sited or retired. Add a
row whenever one comes off the map, and take it out when one goes back.

| Building | Trade | Stood at | Stored | Where it is now | Why |
|---|---|---|---|---|---|
| Lather & Lye | barber and bathhouse | 916,908 Marrow Street | 2026-10-08 | rooms only, no tile | gave its plot to Nico's Noodle Bar |
| 8 Halcyon Boulevard | auctioneers | 895,911 | 2026-10-18 | holding map 1,1 | the Hughson Coliseum |
| The Halcyon Institute | institute | 896,911 | 2026-10-18 | holding map 2,1 | the Hughson Coliseum |
| Halcyon Land Office | land office | 897,911 | 2026-10-18 | holding map 3,1 | the Hughson Coliseum |
| Vetch Green | green, three tiles | 895 to 897,912 | 2026-10-18 | holding map 1 to 3,2 | the Hughson Coliseum |
| 3 Sorrel Way | offices | 895,913 | 2026-10-18 | holding map 1,3 | the Hughson Coliseum |
| 5 Sorrel Way | offices | 896,913 | 2026-10-18 | holding map 2,3 | the Hughson Coliseum |
| 7 Sorrel Way | offices | 897,913 | 2026-10-18 | holding map 3,3 | the Hughson Coliseum |
| Skeleton Crew | locksmith | 898,905 | 2026-10-18 | holding map 1,5 | out of place by the Glasshouse towers |
| Rest Assured | lodging house | 900,905 | 2026-10-18 | holding map 3,5 | out of place by the Glasshouse towers |
| Corner the Market | grocer | 897,907 | 2026-10-18 | holding map 5,5 | out of place by the Glasshouse towers |
| Florist Gump | florist | 909,914 Meltwater Row | 2026-10-18 | holding map 1,7 | Midway Parks Cinema took its plot |
| Rod Almighty | fishing tackle | 908,914 Meltwater Row | 2026-10-18 | holding map 3,7 | taken out for now |
| Loafing Around | bakery | 907,914 Meltwater Row | 2026-10-18 | holding map 5,7 | taken out for now |
| Grind House | bladesmith | 912,913 Foundry Way | 2026-10-18 | holding map 7,7 | taken out for now; its film shows at Midway Parks |

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

## Florist Gump, Rod Almighty, Loafing Around and the Grind House (set aside 2026-10-18)

Midway Parks Cinema moved from 912,914 onto Florist Gump's plot at 909,914, where it faces
Fisherman's Green across Meltwater Row, and four buildings came off the map for now.
[scripts/content/set-aside-meltwater.mjs](../../scripts/content/set-aside-meltwater.mjs) did it.

| Was at | Building | Holding grid | Keeper |
|---|---|---|---|
| 909,914 | Florist Gump | 1,7 | Doreen Fairweather, set aside |
| 908,914 | Rod Almighty | 3,7 | Yusuf Prendergast, set aside |
| 907,914 | Loafing Around | 5,7 | Abel Coyne, set aside |
| 912,913 | Grind House | 7,7 | Vessa Orme: lives in the Meridian, so her `work_zone_id` is `null` instead |

- Each facade moved whole with its id, as the Coliseum's did, and its `world_exit_zone` names itself.
- **Midway kept its id.** `zone_district_912_914` stands at 909,914 with its door north, its door's
  connection turned from east to south, and its auditorium moved behind the foyer. The old street
  link from 912,914 west, `conn_district_912_914_west_cv4h`, was removed.
- The four empty plots (907,914, 908,914, 912,913 and the cinema's old 912,914) are grass named
  Waste Ground, `zone_lot_<x>_<y>`, with a `power_zones` row copied from the building's.
- **The Grind House's film.** Its tape, Sister Steel, was already in Midway's deck and never played.
  It's the late show now, 22:00 to midnight on Friday and Saturday (`flags.deck_programme`), and the
  auditorium's screen takes its picture from the deck in the projection box (`flags.deck_feed`).
  See [systems-broadcast.md](../systems-broadcast.md#media-deck--cassettes).
- Two lines that named the florist were rewritten so nothing points at a shop that isn't there:
  Pavel Ludd's writs node and Just My Type's drying line. Gower Nissen's dialogue says the fair was
  on the green opposite, and has a `film_late` node for the late show.
- Run `scripts\oneshots.bat prod` after the deploy, as for the others.

To put one back, follow the Coliseum's steps, delete or reuse the `zone_lot_` tile on its plot, and
for Florist Gump restore the two florist lines.

## Pill Collins and Ohm Sweet Ohm (set aside 2026-10-18)

Two Greenside Row shops taken out so Grounds for Concern could have a car park and a garden beside it.
[scripts/content/grounds-for-concern.mjs](../../scripts/content/grounds-for-concern.mjs) did it; the
rest is in [grounds-for-concern.md](grounds-for-concern.md).

| Was at | Building | Holding grid | Keeper |
|---|---|---|---|
| 904,908 | Pill Collins | 7,5 | Perpetua Lisk: lives in the Filament Buildings, so her `work_zone_id` is `null` |
| 905,908 | Ohm Sweet Ohm | 9,5 | Teodor Skene: lives in the Yards tenement, so his `work_zone_id` is `null` |

Their plots are `zone_greenside_904_908` (Greenside Gardens) and `zone_greenside_905_908` (Greenside
Car Park). Teodor's signal boards, drone cores and loyalty chips are sold by the Clinkerman now.
