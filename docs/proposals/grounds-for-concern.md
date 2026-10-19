# Grounds for Concern *(as built)*

**Status: BUILT.** The corner café on Greenside Row, rebuilt in place with a roastery and a cellar,
a GLASS arm of its own and a map icon, and a car park and a small garden on the plots where Pill
Collins and Ohm Sweet Ohm stood. Built 2026-10-18. On 2026-10-19 it moved to Any Port's plot at
908,907 as an L round its own car park, Any Port moved behind the water tower, and its old plot
was left to let (§6). §1 to §5 describe the first build; §6 says what the move changed.

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
- The car park isn't parking. No vehicle a player drives can use it. Neither is the café's own lot.

## 6. The waterside swap *(as built, 2026-10-19)*

| Tile | Was | Is |
|---|---|---|
| 910,906 | The Strand, a sand tile | **Any Port**, door west onto Meltwater Row (909,906), district `docks` |
| 908,907 | Any Port | **Grounds for Concern**, door west onto the end of Greenside Row (907,907) |
| 906,908 | Grounds for Concern | **Vacant Plot**, walkable, `building_type: vacant_plot`, `terrain: concrete` |

[scripts/content/waterside-swap.mjs](../../scripts/content/waterside-swap.mjs) does all of it and
is idempotent. Each facade took the tile's id, the way The Slip took the weigh-house's
([marrow-midrises.md](marrow-midrises.md)): every room, map, door, connection, furniture row and
NPC kept its id and follows the facade. The connection files keep their ids too, so
`conn_district_906_908_south_rz25` now joins 908,907 to the café going east.

- **"Behind" the water tower is north of it.** High Water Mark's door is south, onto Meltwater Row.
  `sitecheck.mjs` passes 910,906, and its one road neighbour is Meltwater Row to the west, so that's
  Any Port's door. The Strand still runs past it at 911,906.
- **The café still faces Greenside Row.** The roastery is still south of the café inside, and on the
  map it's the wing down Meltwater Row (908,908), so the two agree. Its back window looks onto the
  car park now. Tobiah's "What happened next door?" became "Didn't you used to be up the road?".
- **The plot is fenced on two sides.** It joins Greenside Row (north) and the old car park (west),
  which now joins it back. Geometry projects links to Meltwater Row and Voss Avenue that its exits
  don't have, so they're blocked connection files (`mint-connections.mjs --write`). The car park and
  the garden lost their mentions of the café.

### GLASS

- **`groundscafe` is an L of two masses**: the café across the whole Greenside Row front, and the
  roastery down the +x side (Meltwater Row) behind it. The door moved to the right of the big window
  so it stays near the Meltwater Row corner, and the corner glazing turns onto +x. The cup sits on
  the roastery roof; the flue climbs the roastery's lot wall. The Basin end of the café has one
  window, and its lot side two.
- **The car park is in the −x, −y corner**, in tile units like the `car_park` arm: tarmac out to
  the quay edge, three bays nosed in to the roastery wall, two cars, the aisle and an arrow in from
  Meltwater Row, bollards along the water, a lamp column and the P sign. The cars and the sign are
  `parkedCar` and `lotSign`, shared with `car_park`.
- **`vacant_plot`** is a type arm in the same file: the bare slab with the counter's strip and bolt
  holes, the roaster's scorch, cracks and weeds, mesh fence panels on concrete feet on three sides
  (one leaning), a gap to walk in by and a letting board. Registered in `TYPE_MODEL`,
  `BLDG_TYPE_3D`, `TYPE_FLOORS` and `NO_KIT`; no map icon, as the car park has none.
- After the move: `npm run shapes:bake` and `node scripts/snapshot-flight-world.mjs` (after a local
  `content:import`).
