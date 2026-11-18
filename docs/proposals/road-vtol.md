# The Corvane Merlin: a sports car that flies

**Status: phases 1 to 3 built in the client (2026-11-17): the model, the cockpit, the cut yoke, the
flight model rows, the engine sound, the HUD colours, and HOVER, LOCK, BOOST and PIT. Pad occupancy,
`flags.vtol_pads`, parked Merlins drawn on their pads, tilting ducts, the depot and the text helm are
design.**

A two-seat mini VTOL conceived as a sports car. It flies like the other VTOLs. Near the ground it
settles into an automatic hover at road height and drives like a car on a cushion a hand's width
above the lane. It locks onto helipads and onto the mini VTOL pads in the car parks. You fly it
and drive it with one race car yoke.

## What it is

- **Maker:** Corvane Aerospace, beside the Viper, Reaper and Shrike in
  [interior-brands.js](../../client/shared/interior-brands.js). Their cabin colours and finish. The
  light line can't be red, amber or green ([systems-flight.md](../systems-flight.md#cockpit-makers-and-stick-rules)).
- **Body:** a late-century wedge supercar, 4.6 m long: a knife nose, the cab pushed forward under a
  steep windscreen that wraps into the door glass, gull-wing doors hinged on the roof rail, NACA
  ducts behind them, a long louvred engine cover with a roof scoop, four round tail lamps and a wing
  on stanchions. Two seats side by side.
- **Lift:** four ducted fans set where a car's wheels would be. The fan housings *are* the wheel
  arches, so it looks like a car when it's parked. In flight the ducts tilt from flat (lift) to
  nose-down (thrust). In road mode they sit flat and a small rear pusher fan drives it along.
- **Skids:** three retractable landing feet with mag-lock pucks on the bottom. They're what clamps
  it to a pad.
- **A mesh file**, `content/vehicle_models/mesh_merlin.json`, written by
  `scripts/shapes/concepts/merlin.mjs` (edit that, not the JSON). The body, the glass, the doors and
  the ducts are stated once in `client/shared/cabin-merlin.js`, which the cockpit reads too. The glass
  is whole faces of the body loft, glazed, so nothing shows through it.

## Three modes

| Mode | Height | What drives it | Where |
| --- | --- | --- | --- |
| **Flight** | anywhere | the flight plugin's continuous sim, `takeoff_mode: 'vtol'` | the sky |
| **Transition** | coming down to 0.5 m, or up off it | automatic: you hold the HOVER button | over any surface it can drive on |
| **Road** | 0.4 to 0.6 m, held by the computer | a car model: grip, slip, lateral drift | the licensed lane, car parks, pads, open ground |

**Transition is automatic.** Below 30 m and under 60 km/h, holding HOVER on the yoke takes it
down. The ducts swing flat, it sheds speed, and it settles onto its ride height over whatever is
underneath and lines up with the lane if there is one. It takes about four seconds, and the pilot
only steers. Holding HOVER on the road reverses it: the ride height climbs past 2 m, the ducts
start to tilt, and the flight sim takes over. Let go halfway and it goes back to where it started.
The transition refuses (and says why) over water, over a crowd and under a bridge.

**Road mode is a car, not a slow aircraft.** It gets its own row of car numbers (mass, grip,
`engineLag`, a short `wheelbase`) and the trucking ground step underneath, so it brakes and
corners like a sports car with a little float in the back. The ride height follows the ground on a
spring through `second-order.js`, so kerbs and ramps lift and drop it. It drives where a truck
drives: the licensed lane ([coldwater-streets.md](coldwater-streets.md)), never the walkways or the
zebra. Off the lane it'll cross open ground and the slum's dirt lanes slowly, the trucks' rules.
It can drive off a region's rim onto the void corridor with the rigs' `joinCorridor`, like every
vehicle.

**The server still decides.** It reconciles reported position the way flight and trucking do, and
it works out the odometer from position. It never trusts a distance from the client.

## Locking onto a pad

A Merlin parks by locking onto a pad, not by landing near one.

- **Pads it locks onto:** every `flags.helipad` tile on a field, the VTOL-only fields (Threshold,
  the Echelon, the Solenne Sky Pad), the rooftop helidecks, and the mini VTOL pads in car parks.
- **The car park pads need to become real.** Today the `car_park` arm paints three pads and draws
  one VTOL on one of them as decoration. This adds `flags.vtol_pads` to a car park tile (pad
  positions in tile units, matching the paint) so the server knows where they are.
- **The catch:** come within a pad's radius below 8 km/h, from the air or along the ground, and
  LOCK lights up on the yoke. Press it and the helideck's catch volume takes over: it eases onto
  the pad's centre and heading, the feet come down, and the pucks clamp. That's `parkAt`, the same
  as a landing.
- **One car per pad.** Who is on each pad lives in RAM. A pad that's taken shows red in the catch
  column and won't light LOCK.
- **The parked car is a vehicle, not part of the building.** Building mass is captured once per
  type, so the car park arm stops drawing its fixed VTOL once parking is real. Parked Merlins are
  drawn as contacts on the pads they're on, so a car park is as full as it really is. Most will be
  empty.

## What's built (phase 1)

| Piece | Where |
| --- | --- |
| The type row and four liveries (Rosso, Nero, Giallo, Bianco) | `content/aircraft_types/ac_merlin.json`, `content/liveries/aircraft_merlin_*.json` |
| The flight model: a heli-model row, the quickest roll in the fleet, light self-levelling, a fast spool | `merlin` in `client/game/js/panels/flight-model.js` |
| The cockpit: a carbon tub, oxblood buckets with diamond quilting and red six-point harnesses, door cards with the pull at the front edge, a firewall port onto the pusher's motor | `client/shared/interior-merlin.js`, gated by `scripts/shapes/cockpit-merlin.mjs` |
| The gull-wing doors open: each leaf lifts 68 degrees on its hinge along the roof rail on the `door` channel, showing a dark aperture behind it, and the cockpit swings its door cards and glass with it. A landed Merlin opens them when the server hands the seat back (`holdForDoors`), so they open before the view closes | `scripts/shapes/concepts/merlin.mjs`, `cockpit.js` `merlinDoor`, `interior-merlin.js` |
| The dash: a leather shelf with double stitching over a lacquered carbon fascia, a brushed aluminium spar, four machined vents, an analogue clock in a chrome bezel, shift lights behind the wheel, a MERLIN plaque, three pages on a glass band | the same file |
| The engine sound: four blade-pass tones beating, the motors' whine, the duct roar, a rev on a paddle blip, contactor clunks at start | `merlin` in `FE_VOICE` and `SPOOL_UP`, `client/game/js/panels/engine-audio.js` |
| HUD colours: green, cyan, violet, ice, magenta or gold, remembered per aircraft type | `HUD_TINTS` in `client/shared/interior-cockpit-kit.js`, `ck:hud` in cockpit.js. Any kit cockpit's HUD follows the choice; only the Merlin has the knob so far |

## The yoke

A cut yoke (2026-11-17; it was a full race wheel): two horns off a flat bottom, open over the top,
with a small screen in its hub, two paddles behind it and keys on its face, and a yellow tab on each
horn's tip that sits level when it's straight. In the air it works the stick freely, as a
helicopter's; on the road its push and pull lock and it only turns. The same yoke does both jobs. It meets the
Drake standard ([cockpit-lettering.md](../reference/cockpit-lettering.md)): every control is
lettered in the legend face, and every control drawn works.

| Control | Road | Flight |
| --- | --- | --- |
| Turn the yoke (A/D, mouse X, relative) | steer | roll, with coordinated yaw |
| Push / pull the yoke (W/S, mouse Y, relative) | locked: W throttles up, S brakes | pitch. W tips it forward and it goes; S pulls back |
| The pedals (Q/E, X/C) | a little steering | yaw, with the side thrusters firing |
| Right paddle | throttle up a step | collective up |
| Left paddle | throttle down / brake | collective down |
| START, LIGHTS, PANEL, CABIN (the face, built) | the four circuits | the four circuits |
| HOVER (lower spoke, yellow ring, K, built) | up into flight | down to the road |
| LOCK (lower spoke, green ring, L, built) | clamp onto the pad under you | clamp onto the pad under you |
| BOOST (right thumb, red ring with its heat arc, Space held or a click for a burst, built) | more thrust and top speed, heats the fans | more push off the ducts, heats the fans |
| PIT (left thumb, blue ring, U, built) | the limiter, 16 kt | nothing |
| The screen (built) | speed, ride height, gear-style throttle step | airspeed, height, the collective's ten steps |
| The HUD knob (on the centre spine, built) | the HUD's colour | the HUD's colour |

The keys are the fleet's ([systems-flight.md](../systems-flight.md#the-flight-keys-as-built-2026-11-17)):
W/S and A/D the stick, R/F the throttle, Q/E or X/C the pedals, the arrows to look, Z to zoom. On
the road W eases the throttle up, A/D steer, and S brakes and, held from a standstill, reverses. The
mouse is relative and holds where you leave it. The stick rule stands: `stickY` positive is a pull.

### What you see it do (as built)

- **Yaw thrusters.** Four jets on the flanks, a pair at the nose and a pair at the tail. Yawing left
  fires the front-right and the rear-left, right the other two, each blowing out on the side away
  from the turn. A plume is a hot cone parked inside the body that slides out of its nozzle on the
  `yawL`/`yawR` channels (cockpit.js `classAnim`).
- **The pusher** spins with forward drive: a little at idle, more with the stick pushed forward or the
  road throttle open, more with speed, most on BOOST. The cockpit integrates its angle (`pushAng`) and
  hands it to the rotor's new `angle` field, so a slow pusher turns slowly instead of twitching.
- **BOOST's flame** (windshield.js `drawMerlinBoost`): a plasma flame out of the pusher, a blue-white
  core, an orange body and a magenta tip, with shock diamonds while it's hottest. It flares hardest
  just after it lights, settles, and dies down as the heat climbs to the cut-out (merlin-modes.js
  `M.flame`). Behind it a heat blur ripples whatever is behind the car: the canvas under the hot air
  is redrawn in thin slices, each shifted by a wobble on the clock.
- **Paint.** Four factory schemes (Rosso, Nero, Giallo, Bianco) in the mesh's `schemes`, each setting
  the lights, seats and metal as well as the body, so Nero keeps violet lights under any pattern. Every
  maintenance pattern now paints the hull, on the Merlin and on every other mesh aircraft (aircraft3d.js
  `paintRgb`: a base slot on the hull falls through to the pattern code).

### How the four work (as built)

`client/game/js/panels/merlin-modes.js`, called by cockpit.js once a frame after the physics, and
gated by `scripts/merlin-modes.mjs`.

- **HOVER** in the air: under 100 ft over the floor and 32 kt, not on a roof, not over water (the
  toast says which). A 3.6 s descent to ride height (1.6 ft), levelling and slowing, then the
  `merlin_road` row takes over (`stepRoad` in flight-model.js). On the road: up to 14 ft and the heli
  row again in 2.4 s. Pressed mid-change, it turns round.
- **Road mode** is flight at 1.6 ft, so `onGround` stays false and the server's reconcile, odometer
  and landing rules apply unchanged. Every surface is the same to it. Wind and turbulence leave it
  alone. A building is a glance, not a crash: it's turned off the wall and slowed, and over 30 kt it
  costs hull, sent as `flightevent scrape <pct>` (0 to 15, Merlin only, rate-limited).
- **BOOST** adds 85% push in flight (and 22% over vne) and 80% on the road. Six seconds of it from
  cold overheats the fans and cuts it for four; it cools in eight. The fans' note climbs with it.
- **PIT** holds the road row to 16 kt.
- **LOCK** lights over a pad within 0.16 tiles at under 7 kt. It eases onto the pad's centre and
  squares to the lot over 2.4 s, then lands with the collective shut, so the server parks it there as
  it parks any VTOL. Pads are the car parks' painted three (`CAR_PARK_PADS`, the `car_park` arm's own
  numbers, through its entrance frame) and ground helipads; a rooftop pad catches a heli by itself.
  Nothing yet stops two Merlins locking onto one pad.

## Sound

A SIREN cue per fan pitched with its load, a pusher whine under it in road mode, and a short
clunk and hiss for the lock. The ducts change note as they tilt, so you can hear the transition.

## The text rung

On the `textgames` and `log` Display Mode rungs the Merlin gets a text helm like the podracer's
`pod`: a `merlin` verb with headings, throttle steps, `hover`, `lock` and `look`, stepping the same
models on the server's `1s` tick, free when nobody's using it.

## Buying and storage

- A depot to [the depot standard](../reference/depot-shell.md): a room at Threshold Helipad you
  walk into, a counter of cards that seat you, buy, hire, sell and service, and the log rung. The
  Solenne Sky Pad sells to residents.
- It's an aircraft row (`type: 'merlin'`), so hangars, liveries, tuning, fuel and repair all work
  with no new tables. No new columns on `players`.
- It needs a VTOL licence to fly and the lane licence that comes with any road vehicle to drive.
  Driving it on the lane without having flown counts as nothing.

## Phases

1. **The model** (built). Mesh in the Modelshop, the cockpit and wheel to the Drake bar, the flight
   model row, the engine sound and the HUD colours. Ducts that tilt and feet that retract are left
   for phase 2, where they mean something.
2. **Road mode and the transition** (built). The road row, the cushion, the HOVER handover both ways,
   BOOST, PIT and the road scrape. Every surface the same, by choice; tilting ducts are still to do.
3. **Locking** (LOCK built). Still to do: `flags.vtol_pads` so the server knows the pads, one Merlin
   per pad in RAM, parked Merlins drawn on their pads, and the decorative VTOL taken out of the
   `car_park` arm.
4. **The depot, sound and the text helm.**

## Open questions

- Does road mode pay the lane like a truck, or is a Merlin cheaper because it's lighter?
- Can it carry anything? A boot the size of a sports car's is about two crates.
- Should a locked Merlin on a pad that isn't yours be towable or ticketed?
