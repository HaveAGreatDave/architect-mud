# Flight Simulator Audio Design

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
