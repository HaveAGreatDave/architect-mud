# Moor or Less and Ring Fenced *(as built)*

**Status: BUILT.** A cheap boatyard at the head of Ironside Street, and a boxing gym in the shed
it replaced on Lever Lane. Four tiles re-dressed, two buildings, three GLASS arms, two map icons,
one powerboat flag (`yard_rate`) and one weightbench flag (`station_style`).

Built 2026-10-07.

## 1. Why Hulls Angels went

Hulls Angels (916,905) was a boat shed a quarter of a mile from any water, run by Keel, who had
spent twelve years on a hull that never left the building. Boats are bought and kept at a marina,
so the shed sold nothing a boat owner needed. Keel moved to the water and the shed became a gym.

Both halves keep the story. Keel's unfinished hull, his shadow-boards and his steam box went with
him, and the gym's front still has the outline of the mast doors.

## 2. The site

The first choice was the inlet south of the airport, at 927–932, 905–908. ⚠ **That water is
outside the Curtain**: the wall runs down column 927 from 927,908, and everything east of it is
radiation 26 and up with no gate. Check `flags.curtain` before siting anything on the east shore.

The yard went to the north end of Ironside Street instead, the east end of the city's own
waterfront, between the Guardian Battery (918,901) and the Load of Old Rope wharf (922,901).

| tile | was | is |
|---|---|---|
| 919,901 | grass | **Ironside Hard**: the end of Ironside Street, a slipway into the Basin |
| 920,901 | grass | **Ironside Hard**: the same concrete, with cradles (`boat_hardstanding: 3`) |
| 921,901 | grass | **Moor or Less**: Keel's shed (`boatshed`, entrance west) |
| 919,900 | water | **The Inner Stage** (`landing_stage`, `marina_berths: 3`) |
| 919,899 | water | **The Outer Stage** (`landing_stage`, `marina_berths: 2`, `boat_fuel`) |
| 921,900 | water | unchanged, but it is the shed's wet slot (the shed room's `north` exit) |

⚠ **Both hard tiles are `terrain: road`.** `authorBuilding` refuses an entrance whose neighbour
isn't a road, and 920,901 is the only side of the shed plot that isn't water or another building.

## 3. Rules the yard is built on

**It's cheaper, and that's a flag.** `flags.yard_rate` is a multiple of the Ascendant list
(`MOVE_IN`, `REFIT_RATE`, the service, paint and decal prices) read by
[yard.js](../../plugins/powerboat/yard.js) `yardRate`/`rateAt`/`moveInFee`, by the crane in
helm.js and by the yard screen's quotes. Moor or Less sets 0.6 on every zone it lets. It doesn't
touch the price of a hull, a hire or fuel: those are the same boats and the same fuel.

**One room is the desk, the shed and the bench.** `desk.js` sells only where a `marina_desk`
stands with its clerk in the room, and `refit` finishes a hull only in a `boat_covered` room with
a `repairman` in it. Keel is all three, so all three are `zone_hulls_shop`. When he goes home
(midnight to six) the desk is shut. Fairweather runs two clerks so its desk never closes; this
yard doesn't.

**The wet slot is a room exit.** `coveredSlot` finds a covered dock's water by its exits, so the
shed room links `north` to 921,900 and the water links back `south`.

**Capacities are what's lettable.** The hard's prose has five cradles with two hulls on them; it
lets three. Same rule as Fairweather (its proposal, §3).

**Two yards, two walks.** `berthsNear` walks seven steps, and the two yards are thirty tiles apart,
so `berth` can't move a hull across the Basin. Regress asserts both directions.

**The interior ids are still `hulls`.** `authorBuilding` derives every interior id from the slug,
so keeping `hulls` moved Keel's rooms, utility room, junction box, generator and power rows onto
921,901 instead of deleting and re-making them. Run the scripts in this order:

```bash
node scripts/content/moor-or-less/batch0.mjs
node scripts/content/moor-or-less/batch1.mjs
node scripts/content/ring-fenced.mjs
```

Three files were deleted: the old facade's west link (`conn_district_916_905_west_c47f`), the
shop's down link (`conn_hulls_shop_down_cf55`) and the old shop door, whose id now belongs to
Keel's new street door. The import's deletion pass only drops a row for a committed deletion, so
a local DB imported before the commit keeps the two connection rows and fails on `zone_edges_pkey`
until they're deleted by hand.

## 4. Ring Fenced

The gym (`gym`, entrance east onto Lever Lane) is Tamsin Brannock's: a former light-welterweight
who fought on the Sump's undercard before it went over to Slagball. It's the first gym in
Coldwater with all three training stations: the heavy bags (`spar`), the bench (`lift`) and the
circuit (`drill`). Before it, the stations were the Sump's back room and a jail cell.

`spar` was written for the Sump's rebound wall and its prose is about slags off steel. A
furniture flag, `station_style: 'bag'`, now picks a style from the station's `styles` table in
[stations.js](../../plugins/weightbench/stations.js). A style swaps the prose and nothing else:
same verb, stat and numbers, which regress checks.

The front says what the building was: the mast-door opening runs from the pavement to the eaves,
bricked to head height in newer buff brick and glazed above, with a steel door cut into the
bottom and RING FENCED painted on a board over it. The old hoist beam still sticks out of the
gable.

## 5. GLASS

- `gym` ([yards.js](../../client/game/js/panels/glass/models/yards.js)): a red-brick works shed
  under a red-oxide barrel roof with a ridge rooflight; four steel windows a side, painted white
  low down; a boiler flue and fire door at the back; tyres by the step; the ring and a bag
  silhouetted in the old door glass after dark.
- `boatshed` ([waterfront.js](../../client/game/js/panels/glass/models/waterfront.js)): tarred
  weatherboard under a galvanised barrel; the name painted on the street gable; the water doors
  open with the hull's frames visible end-on; a rusted lean-to on piles over the slot; the steam-box
  lean-to with its stovepipe smoking.
- `landing_stage`: planks on mismatched oil drums, tyre fenders, and a bulb on a scaffold pole.
  It's symmetric for the pontoon's reason.

⚠ **The boat shed's water is on its left seen from the street (local -x).** That's this tile's
fact, not the type's. A second boat shed has to be sited the same way or needs its own arm.

⚠ **All three are `NO_KIT`.** Each front is a story the derived kit would hang a shutter or a
board across, so each arm draws its own four sides.

⚠ **A flat is never behind a camera test, only a stroke.** The GL mesh is captured once from a
stub camera, so a flat skipped because that camera couldn't see its wall is gone from the GPU
picture for good. The first cut of the gym had its back fire door and grille missing in GL for
exactly that. Flats cull themselves per frame (`flatOut`'s `cullN`); strokes ask `faces()`.

⚠ **On the 2-D painter, flats near the far end of a long wall can lose to the wall.** The warehouse
clerestory does the same. GL depth-tests them and shows every window.

## 6. What isn't built

- **Rent cycles**, as at Fairweather: berthing charges a move-in fee and nothing bills per cycle.
- **Fight nights.** The fight card and Tamsin's dialogue promise Friday bouts. Nothing runs them.
- **The hull.** Keel's boat on the stocks is scenery, not a `boats` row.
