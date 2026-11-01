# One world scale

> **Status: design.** Nothing here is built. Where it disagrees with a `systems-*.md` doc about what
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

## Phases

| Phase | What changes | What a player sees |
|---|---|---|
| 1 | `world-scale.js`; every literal copy (`seat-audio.js`, `aa-emplacement.js`, `birds.js`'s own constant) imports it; `scale:lint` | Nothing |
| 2 | Labels go through `fmtDistance`/`fmtSpeed`: aviation "mi" becomes real nm, the shared `ias` field carries m/s, wind is m/s inside | Distances and speeds that agree with each other |
| 3 | One storey: `FT_PER_FLOOR` comes from `STOREY_M` (11.5 ft, was 12) | Roof and helipad heights 4% lower; the helipad catch needs its regress re-run |
| 4 | One altitude curve for you and every contact | Other aircraft drawn at the height you'd expect |
| 5 | The truck's server clamp and client physics both read `PACE.road` | The clamp stops being looser than the truck |
| 6 | The sea onto the ruler: swell, boats, casting, the sea floor at 17.857 m a tile instead of 7 | The biggest visual change: waves, wakes and casts re-tuned; needs eyes on it |
| 7 | Fuel in litres, burned per km or per hour | Fuel gauges with real numbers |

Phases 1 and 2 are safe to do first and in any order. Phase 6 is the one that needs a person at a
screen.

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
