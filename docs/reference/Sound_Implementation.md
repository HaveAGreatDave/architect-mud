# Flight Simulator Audio Design

> **Author direction, not a spec — largely shipped** in
> [`client/game/js/panels/engine-audio.js`](../../client/game/js/panels/engine-audio.js):
> per-class FM engine beds (piston / turboshaft+rotor chop / turbofan / two-stroke /
> degraded wreck) that track throttle and airspeed, a starter→catch→idle run-up arc,
> a slipstream bed, `groundFx`/`gearFx`/`flapWhir`/`stallHorn`, and per-weather ambient
> loops. Not built: surface-dependent rolling variants, icing/electrical texture.

Extend the existing FM synthesis engine rather than relying on
prerecorded samples.

## Philosophy

Aircraft audio should be procedural, dynamic and mechanical.

React continuously to: - throttle - RPM - airspeed - climb/descent -
rotor load - flaps - landing gear - ground roll

## Engine Layers

Starter -\> Ignition -\> Idle -\> Low RPM -\> Mid RPM -\> High RPM -\>
Full Power.

Blend smoothly.

## FM Direction

Idle: soft rumble with subtle instability. Acceleration: brighter
harmonics and increased modulation. Full Power: aggressive harmonics,
resonance and wind. Throttle reductions should remove harmonic energy
smoothly.

## Helicopters

Layer turbine, transmission, rotor slap, rotor wash and vibration.

## Wind

Increase with speed and become dominant in cruise.

## Ground

Surface-dependent rolling sounds, liftoff transition, touchdown
transition.

## Mechanical Sounds

Hydraulic gear, flap actuators, electrical hum, avionics, vibration.

## Stall

Intermittent horn progressing to continuous warning.

## Crashes

Different sounds for hard landings, overruns and terrain impacts.

## Identity

Embrace Architect's FM synthesized identity instead of photorealism.
Players should recognize every phase of flight from sound alone.
