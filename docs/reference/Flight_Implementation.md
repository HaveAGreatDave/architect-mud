# Flight Simulator Overhaul Implementation

Before beginning, read all relevant project documentation (`.md` files)
and inspect the existing flight plugin, cockpit panel, rendering
pipeline, input handling, vehicle systems, state management, audio
system, and plugin architecture. Extend existing systems rather than
replacing them.

## Goals

-   Evolve the existing simulator, do not rewrite it.
-   Continuous cockpit experience from startup to shutdown.
-   Simplified but believable flight model.
-   Interactive SVG cockpit controls.
-   Preserve Architect's visual identity.

## Flight Model

-   Throttle provides available power.
-   Airspeed provides lift.
-   Pitch trades speed for altitude.
-   Bank turns the aircraft.
-   Stall = excessive pitch + insufficient airspeed.
-   Smooth transitions with inertia.

## Controls

Create SVG yoke, throttle, flap lever, helicopter cyclic and collective.
Mouse dragging should animate controls and affect flight. Retain text
commands.

## Cockpit

Increase forward visibility, improve instrument density, enlarge gauges,
animate needles and switches, preserve existing styling.

## Instruments

Airspeed, Altimeter, Attitude, Heading, VSI, RPM, Fuel, Stall Warning,
multi-engine gauges. Mark Rotate (VR).

## Takeoff/Landing

Remove separate phases. Fly entirely from cockpit. Gentle rotation,
realistic landing evaluation, Star Fox-style runway guidance rectangles,
runway overrun damage.

## Helicopters

Sensitive cyclic, collective controls lift, inertia, hover corrections,
careful landings.

## Polish

Dynamic animations, atmospheric haze, lighting, better minimap, richer
terrain, seamless gameplay.

## Milestones

1.  Continuous flight.
2.  Cockpit controls.
3.  Cockpit redesign.
4.  Instruments & feedback.
5.  Audio.
6.  Renderer.
7.  Terrain.
8.  Environmental polish.
