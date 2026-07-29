# clothing-wetness

**Purpose** — clothes get wet, and wet clothes make you cold. Per-item wetness accumulates from rain and snow and feeds the body-temperature model, which is what turns weather from a description into a threat.

## Commands
None — entirely passive, driven off exposure.

## Hooks
None declared.

## Two rules worth knowing
- **Bare skin still gets wet.** Wearing nothing `gets_wet` doesn't make you waterproof; skin wets at
  the same rate cloth does and dries 8× faster (~7 min soaked-to-dry outdoors, against ~50 for a
  coat), held in RAM since skin has no inventory row. The old flat `wetness = 0` meant a naked
  player in freezing rain took the −15 exposure penalty and none of the ×2 wet cooling multiplier —
  stripping off was a way to shrug off a storm.
- **Sleepers get rained on**, and a dreamer's *body* does too (`bodyZoneOf`, not `current_zone`).
  They just get no wetness messages — they're asleep. Cold is what wakes them.

## What consumes `player.wetness`
The engine's body-temperature drift, two ways: as a **rate multiplier** (soaked ≈ 2× cooling) and — since 2026-07-29 — by **degrading `insulation` itself**, everything except the `hydrophobic` share. That second one is why a rained-on hoodie is now genuinely dangerous and a wet wool scarf is not.

## See also
Wetness also arrives from submersion (**swimming**) and is removed by **laundry**. The body-temperature
drift that consumes `player.wetness` is engine-side — see
[systems-survival.md](../../docs/systems-survival.md#body-temperature--thermal-comfort).
