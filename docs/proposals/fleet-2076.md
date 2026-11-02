# The 2076 fleet

**Status: Dragonfly 2076 built (body, and a cockpit to the 2076 bar, 2026-11-02); Mule 2076 body
and cockpit built, its cockpit being brought up to the bar; the Mayfly and Grasshopper are being
built; the rest is design.** Every aircraft gets a 2076 body and a 2076 cockpit,
worn as its "2076" factory edition beside the vintage one. This file is the brief a build works
from: the canon, the pattern to copy, the standard every build is held to, and the plan for each
aircraft.

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
| Mule | `prop` | hydrogen | Built. Blown-lift freighter after the Electra EL9: eight wing props, a hydrogen power unit, T-tail, rear ramp. | Built; being brought up to the 2076 bar. Split throttles by bank. |
| Mayfly | `ultralight` | charge | Being built. Single-seat tilting eVTOL after the BlackFly and Helix ultralights. | Status lamp reads NO COVER. |
| Grasshopper | `grasshopper` | charge | Being built. Solar-electric tandem scout after the Airbus Zephyr, with a sensor ball. | Solar input from the hour, a sensor page. |
| Locust | `locust` | charge | Being built. Electric hopper mothership after the Pyka Pelican, spray drones docked on the wing. | Spray and drone pages; drones show deployed only while spraying. |
| Drake | `drake` | hydrogen | Design. A printed-to-order air yacht; the duck is a vanity hull. Compound coaxial after the Sikorsky Raider. | Keep its luxury; it already has the richest cockpit, so refit rather than replace. |
| Shrike | `divebomber` | jet | Design. Optionally crewed dive striker; the dive siren becomes a push alert to every tablet in the target zone. | Dive page; the alert's countdown. |
| Leviathan | `heavy` | hydrogen | Design. Hydrogen blended-wing freighter after JetZero and the Radia WindRunner, nose visor kept. | Glass flight deck, cargo page. |
| Reaper | `gunship` | jet | Design. The gun is still the plane; two uncrewed wingmen after the MQ-28 Ghost Bat. | Wingmen page, gun state from `ammo`. |
| Viper | `heli` (armed) | jet | Design. Tiltrotor drone carrier after the MV-75 and Air-Launched Effects. | Needs the armed heli's variant path: today `aircraftFaces` ignores a variant when armed. |
| Carcass | `wreck` | biofuel | Design. A downed 2076 airframe; the recorder survives. | Built off the wreck's existing interior. |
