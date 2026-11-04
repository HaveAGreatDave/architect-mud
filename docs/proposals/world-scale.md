# One world scale

> **Status: phases 1 to 5 and 7 built (2026-11-03); phase 6 built behind a switch, off, and waiting on
> Dave's eyes (see [Phase 6 as built](#phase-6-as-built)).** The ruler, the
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
| The truck's server clamp | 36 m (50 m since phase 5) | `TILE_MPH = 80` in `plugins/trucking/state.js` |
| Boats and the podracer | 42.5 m | `tileMph: 95` in `flight-model.js`, `podracer-model.js` |
| The truck's client physics | 50 m | `tileMph: 112` in `flight-model.js` |
| The Coliseum broadcast | 63.5 m (208.5 ft); on the ruler since it was built at true size | `KH` in `gl/ballpark-mesh.js` |
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
| The ballpark and rink | feet | `FT_M = 0.3048` |
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
moved. A storey in the picture is `FLOOR_Z` (0.028) times `bldgH` and `bldgStretch` (1.4 and 5),
which is the 0.196 tiles on the ruler.

### Phase 4 as built

`heightToZ(m, eye, lift)` in `world-scale.js` is the curve, and its numbers moved there from
`flight-height.js`, which keeps `flightHeight` and `altitudeTiles` as the part that stops at the
top. Two decisions the table didn't make:

- **The curve has to carry on past 3,000 ft.** The eye stops rising there, so a contact drawn
  straight on it would sit level with you however far above it was. Above the top it runs on at
  the old 1/600 a foot. The eye still caps; everything else doesn't.
- **A contact is hung off your own eye**: `contactZ(cam, altDiff)` in `windshield.js` is
  `EHbase` plus the difference on the curve, so a co-altitude contact is level with you at any
  height, including above the top where `EHbase` no longer means your altitude.

Aircraft, gates, missiles, their trails, flares, gun aim and the thermals all draw through it, and
the cockpit's gun solution reads the same curve, so the pipper and the drawn bogey agree.
`contactZ` uses `EHbase`, not `EH`: `EH` has the chase camera's lift in it, so contacts used
to ride up and down with the orbit. They don't now. Near the ground the change is large (from 100 ft,
a contact at 500 ft draws at 3.1, was 2.2); at 3,000 ft and level it's nothing.

`CONTACT_ALT_K` stays for a contact on `groundZ`: the Echelon's deck camera counts feet above the
pad in that frame, and the catch column is sized to it. Those heights are tens of feet.

### Phase 5 as built

`tileMph('road')` in `world-scale.js` turns `PACE.road` back into the sims' number, and the four
trucks in `flight-model.js` and the server's clamp in `trucking/state.js` both read it. The server's
`TILE_MPH = 80` is gone. So is its `TOP_SPEED_MPH = 68`, which turned out to matter more: it was out
of date (the fleet's tops are 82 to 104 mph), so the wire capped a Courier's speed at 68 while the
80 in the divisor happened to leave room for it. The clamp is now each truck's own top speed from
`rig.params` plus the same 35% slack, with the fastest in the fleet for a rig that has no params.
In tiles a second a Courier's ceiling goes from 1.15 to 1.25 and a Barrow's from 1.15 to 0.99.
`rig.speed` is capped the same way, so a truck's contact reports what the dial says above 68.

`state.js` imports `TRUCK_TYPES` from the flight model; the old note about keeping it out of the
server was out of date too, as `rig.js`, `fleet.js` and `textdrive.js` already did. `npm run
scale:check` holds the trucks on the road's pace and the eye on `heightToZ`.

`plugins/column/route.js` has its own `TILE_MPH = 80`, copied from `state.js`. It sets the Wildblood
column's clock, not a truck's, and it's someone else's uncommitted work, so it stays. Moved to the
road's pace, the column would run 29% slower.

### Phase 7 as built

Stored fuel didn't change, so no saved truck, boat or aircraft needs migrating, and no range or
price moved. What changed is what the numbers mean.

- **Aircraft:** one unit of `fuel` and `fuel_capacity` is one litre, or one kWh on the battery
  craft: 800 kWh in a Grasshopper, 1,500 L in a Shrike. `fmtFuel` and `fuelUnit` in
  `client/shared/fuels.js` print them, and `status` gives the burn by the hour while airborne,
  off the same `burnPerTick` the flight tick spends.
- **Trucks and boats** still store a fraction of a tank, because that's what the pump and the
  dials work in. Each type has a `tankL` (trucks 160 to 680 L, boats 30 to 420 L), and the auxiliary
  tank adds to it. Litres are the two multiplied. `litresPerKm` in `road-units.js` gives a truck's
  burn, 0.35 to 0.60 L/km, which the dealer's card prints. The range stays the tuned number.
- **Printed as litres:** the pump's meter on the cab glass, `fuel`'s handle line, the dealer and the
  truck card, the boat at the pumps. **Still a percentage:** fleet lists, condition lines, the
  hangar's gauge bars, and the racer, which has no `tankL`. A percentage is the honest word for how
  full a thing is, and those lines are about the state of the vehicle.

### Phase 6 as built

**Behind a switch, off: the sea players see is the 7 m sea.** `?seaRuler=1` in a browser, or
`SEA_RULER=1` for a gate or a server, sets `SEA_TILE_M` to the ruler. It's a preview: a client and a
server on different settings disagree about a cast or a fish.

Everything in metres lands on the ruler by itself, because it all went through `SEA_TILE_M`:
swell and wind-sea height, the surf, casts, fish, the nav readout and the boat seats'
`metreTiles`. The last two `/ 7` literals (the sub's `rideZ`, the rod rig's fallback) now read it.
Wave LENGTH needed one scale, `SEA_K` (2.55), carried by the sea's frame: `seaFrame` already
wrapped every sample and `seaUnframe` every slope, so a train samples further along itself and the
chain rule brings each slope back. The GLSL's literal coefficients didn't move, so the gate that
compares them needs no change. `SEA_AMP`, the Stokes steepness and `encounterW` carry `SEA_K` too.
With the switch off `SEA_K` is exactly 1, and `sea.mjs` and `boatride.mjs` pass as before.

With it on, the wave is right: at 30 kt a sampled height reads -0.31 m on both settings, the
analytic slope still equals a finite difference, and the roll is 10 tiles where it was 25.6.

**What it still needs before it can be on.**

- **Foam.** At the same wind the near water is far whiter on the ruler, even at state 0.2. Whitecap
  coverage should be the same fraction. This is the first thing to look at: `sea-detail.js`'s
  layers repeat in tiles, and the foam trail ages in tiles.
- **The boat ride.** `SEA_RULER=1 node scripts/shapes/boatride.mjs` passes 91 of 129. `hullLen`,
  `hullBeam`, the crest launch and the chase's `CONTACT_VS` of 1.6 were all tuned in tiles against
  the old swell.
- **`sea.mjs` on the ruler** fails two of its checks: the steepest face is 43 degrees against a
  ceiling of 42, on a sampling grid that's in tiles, and the head-sea test.
- **The water mesh.** `PATCH_R` and `PATCH_PER_TILE` were sized to a 25.6-tile roll and to chop at
  0.6 tiles. Chop is 0.24 tiles now, finer than the mesh, so it's carried by the floor's shading
  alone. Not measured for cost.
- **The seabed** is in metres out and tiles in, so `SHELF_K` and the rest keep their tile distances
  and the shelf falls 2.55 times faster in metres.

When it's right, the switch comes out: `SEA_TILE_M` is `TILE_M`, and `METRE_TILES` goes with it.

## Small fixes found on the way

- `server/engine/clock.js` falls back to a `timeScale` of 3 when the environment can't be read;
  `environment.js` defaults to 1. One of them is wrong.

## Decided

- **Roads read km/h and km** (Dave, 2026-11-01). The truck's dial, the road signs, `route` and the
  world map move from mph and miles. `TILES_PER_MILE` gives way to `PACE.road`, and the mile boards
  in content and prose become kilometre boards in the same phase as the labels (phase 2).
- **The sea moves onto the ruler** (Dave, 2026-11-01). Phase 6 stands: 17.857 m a tile, the swell,
  wakes, casts and the sea floor re-tuned to it, and the boat seats' `metreTiles` correction removed.
- **The Coliseum gets more tiles** (Dave, 2026-11-01), so its stretch stops being a venue scale. It
  stands on 11 by 11 tiles at true size, built on 2026-11-02, with the city grown south to make room
  ([coliseum-true-size.md](coliseum-true-size.md)).
