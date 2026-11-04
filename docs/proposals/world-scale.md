# One world scale

> **Status: phases 1 to 3 built (2026-11-03); phases 4 to 7 are design.** The ruler, the
> conversions, the paces, the labels and `scale:lint` are in, and the truck reads km/h (see
> [Phase 2 as built](#phase-2-as-built)). Where this disagrees with a `systems-*.md` doc about what
> ships today, that doc wins until the phase that changes it lands.

## Why

Ask the code how big one map tile is and you get eleven answers:

| Who's asking | One tile is | Where |
|---|---|---|
| The sea, fishing, the sub | 7 m | `TILE_M` in `client/shared/sea-swell.js`; the sub's own `* 7` |
| Buildings, birds, people, GLASS | 17.9 m | `BIRD_M_PER_TILE = 3.5 / 0.196` in `client/shared/birds.js`; literal copies in `seat-audio.js` and `glass/aa-emplacement.js` |
| The cab and racer seats | about 22 m | `EYE_M` against `SEAT_EYE_TILES` (`interior-shell.js`, `windshield.js`) |
| The truck's server clamp | 36 m | `TILE_MPH = 80` in `plugins/trucking/state.js` |
| Boats and the podracer | 42.5 m | `tileMph: 95` in `flight-model.js`, `podracer-model.js` |
| The truck's client physics | 50 m | `tileMph: 112` in `flight-model.js` |
| The Coliseum broadcast | 63.5 m (208.5 ft) | `KH` in `gl/ballpark-mesh.js` |
| Aircraft over the ground | 257 to 514 m | `worldPace` and `AIR_PACE` in `windshield.js`, `cockpit.js` |
| Road signs and the world map | 536 m | `TILES_PER_MILE = 3` in `client/shared/road-units.js` |
| Aviation distances | 1,609 m | the tile count printed as "mi" (`plugins/flight/state.js`) |

Height has its own split: a storey is 3.5 m to the renderer and 12 ft (3.66 m) to `FT_PER_FLOOR`,
and the aircraft you fly is drawn on a square-root altitude curve (`flight-height.js`) while every
other aircraft is drawn on a straight 1/600 (`CONTACT_ALT_K`). One `ias` field carries mph from a
truck and knots from a plane. Wind is km/h in the weather and knots at sea. Fuel has no unit at all.

Most of these are not mistakes. They're one real decision, made separately each time without a name:
**the map is drawn to one size, and travel across it is compressed so a city crosses in minutes.**
This proposal names that decision, puts it in one file, and makes everything else follow from it.

## The model: a ruler, a pace, and frames

### 1. The ruler (one value)

Everything drawn is drawn in metres on one ruler:

**1 tile = 3.5 / 0.196 m = 17.857 m.** A storey is **3.5 m**, and 0.196 tiles.

It's the value GLASS, the birds, people (`ACTOR_S` 1.75 m) and trees already use, so no building,
bird or person changes size. It's not rounded to 18 m because that would move every roof.

Everything else that's drawn joins it: the sea, boats, trucks, aircraft (still drawn at true size up
to 10 m, as `glass-notes.md` already does), furniture and rooms (the Room Stage proposal, `docs/proposals/room-stage.md`).

### 2. Paces (one table)

A pace is how many world metres a mode covers for each metre its own instruments say it went. It's
the time compression that lets you cross Coldwater in a truck in a few minutes, written down instead
of hidden inside a tile size.

| Mode | Pace | What it replaces | What it means |
|---|---|---|---|
| On foot | one tile a move | the discrete move | A move is a tile; no speed shown |
| Road, city | 0.357 | `tileMph: 112` (a 50 m tile) | 112 mph on the dial crosses 1 tile a second |
| Road, highway corridor | per route | `TILES_PER_MILE = 3`, `roomLen` | A corridor room stands for a stretch of real road; the route says how long |
| Sea | 0.42 | `tileMph: 95` (a 42.5 m tile) | 95 mph on the dial crosses 1 tile a second |
| Air | 0.035 to 0.07 | `worldPace`, `AIR_PACE` | Cruise crosses a tile in about the time it does now |

The numbers in this table are today's behaviour expressed against the ruler, so phase 1 changes no
speed. Tuning a pace later is one number in one place.

**Instruments always read true.** The speedometer, airspeed and log show the vehicle's real speed.
The odometer, trip distances, ranges and "nearest field" show distance on the vehicle's own
instruments, which is world distance divided by its pace. A pilot's 40 nm to the field and a
trucker's 12 miles to the yard are both honest about the trip; the map is just drawn smaller than the
trip.

### 3. Frames (local, declared)

Some things are modelled in their own unit, and that's fine as long as each says what its unit is:

| Frame | Unit | Declared as |
|---|---|---|
| The ballpark and rink | feet | `FT_M = 0.3048`, and the Coliseum's stretch (`KH`) as a named venue scale |
| The Kitchen Stage | cm | `CM_M = 0.01` |
| Cockpit and cabin interiors | per-craft units | each interior's `M_PER_UNIT` |
| Building models | tiles (`fh`, `h`) | the ruler |

A frame never invents its own tile size. It converts to metres with its declared factor and to tiles
through the ruler.

## Units

Inside the code, SI: metres, seconds, m/s, kilograms (item `weight` stays in grams, as now), litres,
°C, degrees for bearings. On screen, what the person in that seat would read:

| Where | Distance | Speed | Height |
|---|---|---|---|
| On foot, rooms, fishing, the sea floor | m, km | km/h | m |
| Roads | km | km/h | m |
| The air | nm | knots | ft (as aviation does everywhere) |
| The sea | nm | knots | m (depth) |
| Weather | km | km/h, knots in the marine forecast | m |

## One file

`client/shared/world-scale.js`, imported by the client and the server (the server already imports
`client/shared/`):

- `TILE_M`, `STOREY_M`, `STOREY_TILES`, and `m2t()`/`t2m()`.
- Conversions: `FT_M`, `NM_M`, `MI_M`, `KT_MS`, `MPH_MS`, `KMH_MS`.
- `PACE`, the table above.
- `heightToZ(m)`: the one altitude curve. The aircraft you fly, every other aircraft and every roof
  draw through it, so a contact at your altitude is drawn at your altitude.
- `fmtDistance(mode, m)`, `fmtSpeed(mode, ms)`: the only way a distance or speed reaches a screen.

A gate (`scale:lint`, in `docs:lint`'s style) fails on a new literal `17.857`, `17.9`, `3.28084`,
`0.3048`, `0.8689` or `1.688` anywhere outside that file, and on the sub's tile-as-7-metres, and ratchets the existing
ones down as phases land.

**As built (phase 1).** [client/shared/world-scale.js](../../client/shared/world-scale.js) has
everything above but `heightToZ`, which waits for phase 4. Three things were added on the way:
`tripM(mode, tiles)` (world tiles as that vehicle's instruments read them), `paceOf(mode)`, and
`kmOf(m)`. `PACE` has a fourth row, `corridor`, for the void highway's three tiles to the mile, and
`PACE.air` is `{ ground, cruise }`; distance labels use the cruise pace. The sims still hold their
own copies of the paces until phase 5. `scale:lint` is
[scripts/scale/lint.mjs](../../scripts/scale/lint.mjs) (`npm run scale:lint`, `--list`,
`--update`), in its own `scale` group in the gate manifest. It also counts `3.5 / 0.196`, and it
skips comments and files with a GENERATED header. The sub's `* 7` isn't counted yet: that's
phase 6's to remove. Its baseline holds four hits, all coincidences (two hash seeds, a gust period,
a hairline table).

Every copy of the ruler and of the foot now imports it: `birds.js`, `seat-audio.js`,
`glass/aa-emplacement.js`, and also `glass/media-lot.js`, `coliseum-plan.js`, `angler.js`,
`glass/rod-rig.js`, `gl/ballplayer-mesh.js`, `interior-grasshopper-2076.js` and
`plugins/flight/state.js`'s knots-to-feet-a-second. `seat-audio.js` read 17.9 and the two glass marks
17.857, so their numbers moved by 0.24% and 0.0008%, and the glide check's 1.688 by 0.01%; the
rest are the same number.

## Phases

| Phase | What changes | What a player sees |
|---|---|---|
| 1 | `world-scale.js`; every literal copy (`seat-audio.js`, `aa-emplacement.js`, `birds.js`'s own constant) imports it; `scale:lint` | Nothing |
| 2 | Labels go through `fmtDistance`/`fmtSpeed`: aviation "mi" becomes real nm, the shared `ias` field carries m/s, wind is m/s inside | Distances and speeds that agree with each other |
| 3 | One storey: `FT_PER_FLOOR` comes from `STOREY_M` (11.5 ft, was 12) | Nothing: see [Phase 3 as built](#phase-3-as-built) |
| 4 | One altitude curve for you and every contact | Other aircraft drawn at the height you'd expect |
| 5 | The truck's server clamp and client physics both read `PACE.road` | The clamp stops being looser than the truck |
| 6 | The sea onto the ruler: swell, boats, casting, the sea floor at 17.857 m a tile instead of 7 | The biggest visual change: waves, wakes and casts re-tuned; needs eyes on it |
| 7 | Fuel in litres, burned per km or per hour | Fuel gauges with real numbers |

Phases 1 and 2 are safe to do first and in any order. Phase 6 is the one that needs a person at a
screen.

### Phase 2 as built

**Done.**

- **Aviation distances are nm on the aircraft's instruments**: `fmtDistance('air', tripM('air',
  tiles))`, at the cruise pace, so 24 tiles reads 3.3 nm where it read "24mi", and a field's
  distance over your airspeed is the time it takes. The cockpit's guide label, the target toast,
  the TGT radio row (`cockpit.js`), the text pilot's nearest strip (`textpilot.js`) and the charter
  pilot's fare line (`charter.js`) print it. `gpsTo.dist`, which the 2076 cockpits' GPS digits
  show, is nm now; those digits round to whole nm, so under a mile reads 0.
- **`ias` on a contact is m/s from every producer**: aircraft (`airContact`), trucks, boats and
  the podracer. It's converted at the readers: `world-feed.js` hands the renderer knots, the
  cockpit dead-reckons and frames contacts from knots, and `boat-audio.js` hears mph. A truck's
  contact used to put mph in a field the cockpit read as knots, so its dead reckoning in a pilot's
  view is now 13% slower. Neither number is a truck's real ground rate, which is why
  `world-feed.js` takes velocity from successive positions.
- **Road distances are km**: `roadKm(tiles)` in `road-units.js` (on `PACE.corridor`) replaces
  `milesOf`, and the boards on the verge (digits only, so the GLASS board needed no change), the
  board text on the log rung, the `route` verb and the cab's route list (the payload field is `km`,
  was `miles`), the world map's route list (`km`), the hitcher calls (32, 10 and 3 km, were 20, 6
  and 2 miles), the plaza radio, the weighbridge line, the flag-down line and the truck dealer's
  range ("km a tank", was "tiles a tank") all print it. The CB chatter and the two player guides
  say kilometres. `plugins/trucking/regress.js` checks the new numbers.

- **The windshield.js labels are nm and km**: both target rings in `drawAirportTarget`, the
  designated contact's range and the cab GPS strip (`legLeft`, now km).
- **The truck reads km/h.** The painted speedo in `drawCabInterior` scales to the truck's top speed
  rounded up to a 20. The 3D cabs' dials in `interior-fit.js` run to 140 (the Barrow) and 180 where
  they ran to 70 and 80, which pinned every truck's top speed; the Courier 2076's read-outs, the
  cruise button, the screen-reader readout, `textdrive.js`, the dealer cards and the crash line all
  print km/h. The sim and every `*_MPH` threshold stay mph inside, with `MPH_KMH` at the labels. The
  hidden readout says `KM TO GO`: `legKm()` in `cab-view.js` uses the boards' measure on a
  corridor leg and `PACE.road` on a city leg. `TILES_PER_MILE` is gone.

**Not done, and why.**

- **Wind stays km/h inside.** The labels already match the Units table (weather km/h). Moving the
  inside to m/s reaches `server/engine/environment.js`, `plugins/weather`, the schema, the dev
  panel's weather tab and windshield.js, which is more than a label pass should carry.
- **Content has no mile boards.** The boards are built in `corridor.js`. What content says in
  miles is flavour ("nothing stands up out of it for miles") and names (The Bare Mile, Ninemile),
  and stays. No content file changed.
- **Boats and the podracer** still show mph. The Units table says knots at sea; the boat seats'
  dials, `boat-view.js` and `plugins/powerboat` would move together. The podracer has no row in
  the table.

**Found on the way.**

- The literal copies were more than the three named above (see As built, phase 1).
- The text pilot has its own air pace: `TILES_PER_SEC_AT_CRUISE` (0.18 tiles a second at each
  type's own cruise, `plugins/flight/textpilot.js`), which the PACE table doesn't list.
- `worldPaceMult` (1.7 on the Reaper, `flight-model.js`) makes that aircraft cross the ground
  faster than its airspeed says, so its nm and knots disagree by that factor.
- `cockpit.js` turns wind into knots with `* 0.28`, commented as "the flight model's kph-to-kt
  scale". The real factor is 0.54; it's a tune that halves the wind, not a conversion.
- `trucking/index.js` called `milesOf` on the weighbridge's "nothing to weigh" line without
  importing it, so that line threw. It uses `roadKm` now, imported.

### Phase 3 as built

`FT_PER_FLOOR` is `STOREY_M / FT_M`, 11.48 ft. The table used to promise roofs and helipads 4%
lower and a re-run of the helipad catch's regress, but nothing has read `FT_PER_FLOOR` since
collision moved onto captured shapes (`building-shapes.md`): the only other mention is the lazy
facade's export. A roof's feet come from the drawn model through `altForRoofZ` and
`altRestingOnZ`, which invert the eye curve, and that's where the catch reads its deck. So no height
moved. A storey in the picture is `FLOOR_Z` (0.028) times `RENDER_TUNE.bldgH`, which is the
0.196 tiles on the ruler.

## Small fixes found on the way

- `server/engine/clock.js` falls back to a `timeScale` of 3 when the environment can't be read;
  `environment.js` defaults to 1. One of them is wrong.
- `plugins/trucking/regress.js` checks that the server clamp is looser than the client physics, which
  enshrines the 80 against 112 split rather than catching it.

## Decided

- **Roads read km/h and km** (Dave, 2026-11-01). The truck's dial, the road signs, `route` and the
  world map move from mph and miles. `TILES_PER_MILE` gives way to `PACE.road`, and the mile boards
  in content and prose become kilometre boards in the same phase as the labels (phase 2).
- **The sea moves onto the ruler** (Dave, 2026-11-01). Phase 6 stands: 17.857 m a tile, the swell,
  wakes, casts and the sea floor re-tuned to it, and the boat seats' `metreTiles` correction removed.
- **The Coliseum gets more tiles** (Dave, 2026-11-01), so its stretch stops being a venue scale.
  How many, and what it displaces, is still open below.

## Open questions

- **How big the Coliseum grows.** The bowl is about 613 ft (187 m) a side, so true size at the ruler
  is 11 by 11 tiles. Halcyon Fields is 163 tiles, 20 wide and 11 tall, so true size takes most of
  the district.
