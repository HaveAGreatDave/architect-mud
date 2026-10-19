# Grounds for Concern *(as built)*

**Status: BUILT.** The corner café on Greenside Row, rebuilt in place with a roastery and a cellar,
a GLASS arm of its own and a map icon, and a car park and a small garden on the plots where Pill
Collins and Ohm Sweet Ohm stood. Built 2026-10-18.

## 1. What changed

| Tile | Was | Is |
|---|---|---|
| 904,908 | Pill Collins, chemist | Greenside Gardens, `zone_greenside_904_908`: a park tile with benches |
| 905,908 | Ohm Sweet Ohm, electronics stall | Greenside Car Park, `zone_greenside_905_908`: walkable, `building_type: car_park` |
| 906,908 | Grounds for Concern on the generic shop mesh | Grounds for Concern, `coffee_shop`, map code `GC`, sign trade COFFEE |

The garden and the car park join Greenside Row to Voss Avenue both ways and join each other. The
café's door is still north onto Greenside Row.

[scripts/content/grounds-for-concern.mjs](../../scripts/content/grounds-for-concern.mjs) does all of
it and is idempotent.

## 2. The two shops are set aside

Both facades moved whole onto `map_set_aside` at holding grid 7,5 (Pill Collins) and 9,5 (Ohm Sweet
Ohm), the way the Kettle three were the same day ([stored-buildings.md](stored-buildings.md)). Each
keeps its id, rooms, furniture, door and Ohm Sweet Ohm's card machine; its `world_exit_zone` names
itself. Perpetua Lisk and Teodor Skene live in buildings that stay, so they aren't set aside: their
`work_zone_id` is `null`.

⚠ **Teodor was the only seller of signal boards**, which six SPECTER recipes need, and of drone
cores and loyalty chips. Those three and his glowing scrap, cracked circuits and depleted batteries
are on the Clinkerman's list at Slag & Wares now. Everything Perpetua sold is sold elsewhere
(Dosed & Confused has most of it).

Run `scripts\oneshots.bat prod` after the deploy: `set-aside-players.mjs` moves anyone left in the
two shops' rooms.

## 3. Inside

| id | what |
|---|---|
| `zone_grounds_cafe` | The Café: counter, lever machine, six tables (sit), the photographs, games shelf, honesty jar, chalk board, till |
| `zone_grounds_roastery` | The Roastery, south of the café: the drum roaster, sacks, bagging bench, sink (water) |
| `zone_util_zone_grounds_cafe` | The Cellar, down from the café: the junction box |

The ids are the old ones under the slug `grounds`, so nothing that pointed at the café moved. The
cellar was reachable only from below before (a one-way connection and no `down` on the café); its
connection is two-way now. The café had no vendor safe, so Tobiah's takings never moved; the till
is one.

Tobiah Gresh keeps his id and hours (06:00 to 17:00). He sells a cup of coffee (5), Bishop's Blend
(20), cold brew, the new **butter tart** (4), dripping bread, grounds, chicory and a chipped mug, and
he'll explain the roaster and what happened next door (with a route to Dosed & Confused).

⚠ **The café keeps its old connection files.** `authorBuilding` writes a `conn_hf_*` file for every
link; two files on one pair project the same edge twice and the import fails on `zone_edges_pkey`.
The script drops the new file wherever an old one already covers the pair.

## 4. GLASS

Both arms are in [greenside.js](../../client/game/js/panels/glass/models/greenside.js).

- **`groundscafe`**, bound by name (`groundsforconcern`, `trade: 'coffee_shop'`): one storey of red
  brick on a slate plinth under a cream cornice. A bottle-green timber shopfront wraps the corner onto
  Meltwater Row, lit warm after dark, with the door near the corner, a green and cream striped awning,
  two bistro tables and the chalk board (four lines, three struck out). The name is on the fascia
  once, with COFFEE under it from `sign_trade`. On the roof a white cup on a saucer with a green band
  steams, because the roaster's flue climbs the car-park wall and runs across the roof into its
  plinth. The back has the roastery door, a pallet of sacks and two bins. The kit's `ground`, `wall`,
  `signRoof` and `stair` are declined.
- **`car_park`**, by type and Coldwater-free: tarmac, kerbs, five bays with wheel stops, a footpath
  strip, an arrow in, three parked cars, a lamp column, a P sign reading CUSTOMERS ONLY, and bollards
  across the back. Everything is in tile units. The Codfather's `staff_lot` draws through it too.
- Registered in `NAMED_MODELS`, `TYPE_MODEL` (`coffee_shop` falls back to the shop mesh in the café's
  brick), `BLDG_TYPE_3D`, `TYPE_FLOORS`, `SIGN_WORD` (COFFEE), `SIGN_HANZI` (咖啡), the trade hand and
  pictogram table (`mug`), `KIT_DECLINE`, `NO_KIT` (`car_park`) and the POI table (restaurant). New
  palette keys `ty_gfc_brick`, `ty_gfc_green`, `ty_gfc_cream`.
- Map icon: [bldg_coffee.svg](../../client/game/assets/zone-icons/bldg_coffee.svg), a steaming cup.

## 5. Not built

- The roaster has no schedule: the cup steams at every hour.
- The car park isn't parking. No vehicle a player drives can use it.
