# The 2076 fleet

**Status: all eleven built (2026-11-02).** Every aircraft has a 2076 body and a 2076 cockpit to the
2076 bar. Since 2026-11-06 the 2076 is what the line builds: it's each class's default livery, so the
dealer, the rental desk and any unpainted aircraft get it, and an aircraft stored as stock draws it
with its colours kept. The stock sets sit behind the `retired_stock` flag, which nothing sets. The
wreck class stays stock, and stats are still the type row's. This file is the brief a build
worked from: the canon, the pattern to copy, the standard every build is held to, and the plan for
each aircraft.

## Canon

The Handoff is in the late 2070s ([story.md](../story.md)), so the fleet is 2070s equipment. Every
aircraft can fly itself. Halcyon Assurance's Warm Hands Rider voids hull cover unless a living pilot
is at the controls, so the cockpits keep real controls and the panel says, politely, that they are
advisory. Fuels are charge, hydrogen, jet and biofuel (`client/shared/fuels.js` and the Fuels section
of [systems-flight.md](../systems-flight.md)); a type's `fuel_type` is already set.

## The pattern to copy

The Dragonfly 2076 is the reference. Read these before building another:

- `scripts/shapes/concepts/dragonfly-2076.mjs` writes `content/vehicle_models/mesh_heli_2076.json`:
  a fine body (`minDetail: 1`) and a coarse one for range (`maxDetail: 0`), with `lamps`, `rotors`
  and `paints`. Helpers are in `scripts/shapes/fw-meshes/lib.mjs`; the fixed-wing builders beside it
  show wings (`foil`), control surfaces (`ctrlOn`) and gear.
- `client/shared/cabin-dragonfly-2076.js` states the cabin and its glass once. The generator and
  the cockpit both import it, so the inside of the windscreen is the windscreen you see outside.
- `client/shared/interior-dragonfly-2076.js` is the cockpit, and
  `scripts/shapes/cockpit-dragonfly-2076.mjs` is its gate.
- The wiring, all small and additive: `"variants": {"2076": "<base>_2076"}` on the base mesh (and in
  its builder if `build.mjs` generates it); the mesh id in `VEHICLE_IDS.mesh`
  (`client/shared/vehicle-model-schema.js`); a `TRIMS` entry in `plugins/flight/livery.js`; a livery
  in `content/liveries/aircraft_<class>_2076.json`; a `SHELL_PROFILES` getter and a `shellProfileFor`
  line in `client/shared/interior-shell.js`; the gate in `scripts/gates/manifest.mjs`; a seat in
  `scripts/shapes/cockpit-controls.mjs`. Then `npm run vehicles:bake` and `npm run liveries:bake`.
- Keep the base mesh's frame and scale so the new body sits on the ground the same way.

## The standard

1. **Detail.** At or past the Drake's level (about 4,800 faces; the Dragonfly 2076 is about 6,300
   near and 272 far). Glazing with frames and seals, panel seams, hatches, vents, sensors, antennas,
   lamps, real gear, props or rotors as `rotors`, control surfaces as `ctrl` parts.
2. **One forward view.** From the default view (eye at the origin, looking forward, pitched about
   12 degrees down, an 85 degree lens) every clickable control is visible. Grab controls that sit
   low (stick, thrust, pedals, flaps) are mirrored on a forward screen or the head-up combiner and
   move with them. The cockpit gate checks both.
3. **Feedback.** Keys dip while pressed and ease back (`eased`, `pressPulse`, `live.press`), lights
   ease with their circuit, a ring flashes on a change, and levers and indicators move with their
   values. Anything that spins turns on `live.phase`.
4. **Futuristic but functional.** Every readout is a real sim value or honestly derived from one;
   every control that looks operable is a real hotspot wired to an action in `DK_ACT`
   (`client/game/js/panels/cockpit.js`). No handles or switches for systems the sim lacks. One display
   language: dark glass with a lit top edge, teal normal, amber caution, red warning, the current
   value brightest.
5. **Lettering.** Only A to Z, 0 to 9, hyphen, slash and space; nothing under the legibility ratchet;
   every lettered panel faces the eye. No em dashes in anything a player reads.

6. **The 2076 bar** (2026-11-02: "futuristic them considerably"). Every 2076 cockpit has all four:
   - **Wraparound glass.** One curved band of glass across a swept dash, door to door, with every
     page, key and lamp lying on it (`glassBand`, `bandFrame` in `interior-cockpit-kit.js`).
   - **A projected HUD and a hologram.** Conformal symbology in the windscreen with the low
     controls mirrored in its corners and nothing on the boresight (`windscreenHud`); a translucent
     miniature of the aircraft over the dash that pitches, banks and spins its props with her, on a
     projector whose arc is a real value (`holoFrame`, `holoProjector`).
   - **A sculpted interior.** Dash and console swept, not boxed (`sweep`), with light lines along
     the lips (`lightLine`) in the alert colour: teal, amber, a red that breathes (`alertLight`).
   - **Animated life.** Pages boot in turn when the power comes on (`bootAge` off `live.powerAge`,
     `reveal`), and controls light as the hand comes over them (`live.hover`). Decoration may move
     on wall time; a readout still moves only on a live value.

Each build passes its own cockpit gate, the controls gate, the shell gate, the aircraft's old cockpit
gate, the liveries gate, the full gate run and `tests/regress.js`.

## The plan, aircraft by aircraft

| Aircraft | Class | Fuel | 2076 body | Cockpit notes |
| --- | --- | --- | --- | --- |
| Dragonfly | `heli` | charge | Built. Two-seat eight-rotor pod after the EHang EH216-S. | Built to the 2076 bar: the reference. |
| Mule | `prop` | hydrogen | Built. Blown-lift freighter after the Electra EL9: eight wing props, a hydrogen power unit, T-tail, rear ramp. | Built to the 2076 bar. Split throttles by bank, a hologram on the bank rpm, the manifest page. |
| Mayfly | `ultralight` | charge | Built. Single-seat tandem-wing eVTOL after the BlackFly and Helix ultralights: eight props, a bubble pod. The tilt is drawn in cruise only; the class has no tilt channel. | Built to the 2076 bar. A NO COVER lamp, lit with the power. |
| Grasshopper | `grasshopper` | charge | Built. Solar-electric tandem scout after the Airbus Zephyr: a celled wing on a pylon, a slender pod, a chin sensor ball. | Built to the 2076 bar: solar input from the hour and the weather, a sensor page, a hologram with a sunlit wing. |
| Locust | `locust` | charge | Built. Electric hopper mothership after the Pyka Pelican: a battery under the belly, a six-blade prop, ten spray drones docked on the wing that fly out off each tip on the `spray` channel while she sprays. | Built to the 2076 bar: spray and drone pages, a SPRAY key (`ck:spray`), a hologram whose drones launch with the valve. |
| Drake | `drake` | hydrogen | Built. A printed-to-order air yacht after the Sikorsky Raider X; the duck is a vanity hull. `scripts/shapes/concepts/drake-2076.mjs` starts from `mesh_drake.json` and keeps its skeleton, so every part name and channel the code reads (`head`, `eye window`, `cabin`, `wings`, `brake`, `rotorFold`, `boat`, `ramp`, `gear`, `ski`, `paddle`, `feetGone`) and every face that meets the ground or the water are the stock Drake's. Over it: framed saloon windows where the armour was, a faired hub on four-blade rotors, a gearbox hump, a stator'd duct, sensors and light lines, in champagne pearl and titanium. | Built to the 2076 bar as a refit (`interior-drake-2076.js`): the stock room with `refit` set, so `drakeFit` keeps the luxury (pantry, locker, bucket, mode gate, yoke) and leaves out the pod, strips, stands and trim cheek for the band. Every stock control id keeps its action; the low ones keep their hotspot and get a band key too. Worn as cabin trim `2076` (`CABIN_TRIMS.drake`) beside Mandarin, Darkwing and Quackhawk, whose cockpits are unchanged. |
| Shrike | `divebomber` | jet | Built. Optionally crewed single-seat dive striker: one jet fed by a raked chin intake, a chined hull with the beak kept, the inverted gull wing cranked and swept with the slatted dive brakes under it, the bomb on a trapeze in a bay, fixed talon legs. The `diveBrake` channel swings the brakes and opens the bay. The siren becomes a push alert to every tablet in the target zone; the server still sends the old wail. | Built to the 2076 bar. A dive page on the server's own gate (35 degrees, 140 kt, under 1200 ft, armed) with the pull-out height for a 4 g pull; an alert page counting down to the release height from alt and vsi; a DIVE key on the dive computer (`ck:dive`). |
| Leviathan | `heavy` | hydrogen | Built. Hydrogen blended-wing outsize freighter after JetZero and the Radia WindRunner: one lifting body as wide as the hold, four fans on the aft deck between canted fins, a glazed cab on the nose. The visor is kept, cab and all, on the `noseVisor` channel. | Built to the 2076 bar. Four thrust levers and four HUD carets; a cargo page with the visor, the ramp and the throttle baulk, and no load figure because the sim carries no cargo mass. |
| Reaper | `gunship` | jet | Built. The gun is still the plane: a seven-barrel cannon in the open under the chin, a drum in the belly, a frameless gold-tinted bubble on an armoured tub. Aft of the cockpit a flat engine deck with both turbofans buried in it, dorsal intakes under raked visors and slot nozzles over a beavertail; two fins canted hard out on the deck edges over a swept tailplane; a swept wing with raked tips and strakes. No wingmen: the MQ-28-style drones and their `wingmen` channel were taken out on 2026-11-09. The hull, wing, tail, engines and pylons are stated once in `cabin-reaper-2076.js`. | Built to the 2076 bar. Split throttles, a gun page off `ammo` and `weapon`, a stores page off `missiles` and `bombs`, an ARM key (`ck:arm`), a hologram with her stores on their pylons whose projector arc is the rounds left. |
| Viper | `heli` (armed) | jet | Built. Tiltrotor drone carrier after the MV-75: two proprotors on wingtip nacelles (drawn in helicopter mode; the class has no tilt channel), the chin gun, stub wings and pods kept, eight Air-Launched Effects drones, held in their tubes for now (the `drones` channel stays at 0 until they have a job in the sim). | Built to the 2076 bar: weapons and effects pages, the collective mirrored in the HUD, a tiltrotor hologram. The armed heli now takes a variant: `bodyVariantFor` reads `heli_armed`'s own `variants`. |
| Carcass | `wreck` | biofuel | Built. A 2070s single-seat composite homebuilt after the Sonex Onex, found downed and flown again: the port outer wing and aileron a donor's in faded blue, one winglet and a snapped stub with a bicycle lamp, a cracked and taped bubble, the starboard cowl side gone so the biofuel twin shows, a road sign over the port flank, a primer-red rudder, one spat; the flight recorder shows orange in the tail cone where its hatch was. No player can get one yet: the wreck class can't be bought, rented, test-flown or rebuilt into, and a crashed aircraft draws the stock Carcass. | Built to the 2076 bar off the old tub's layout: a cracked glass band with a dead page and a flickering one (wall time, decoration only), the Fly Baby's toggle taped on for the dome, a recorder page of live channels (`FDR`), and a glitching hologram of her with the donor wing in amber. |
