# clothing-wetness

**Purpose** — clothes get wet, and wet clothes make you cold. Per-item wetness accumulates from rain and snow and feeds the body-temperature model, which is what turns weather from a description into a threat.

## Commands
None — entirely passive, driven off exposure.

## Hooks
None declared.

## Rules worth knowing
- **Water runs outside-in.** Rain lands on your outermost layer and only what that layer *passes*
  reaches the next one down, and finally the skin (`layerPassthrough` / `stackFlux`). A garment's
  passthrough is the whole model in one number: `waterproof` sheds all but 0.05, hard armour that
  holds no water sheds 0.9 straight onto what's below, and cloth passes `0.15 → 1.0` **as it
  saturates** — so a dry coat protects the shirt under it and a soaked one doesn't. Before this,
  every equipped garment wet at the same rate simultaneously, which meant a slicker over a shirt
  left the shirt exactly as soaked as no slicker at all.
- **`player.wetness` is how wet you FEEL, area-weighted.** Per slot it's the water against the skin
  and in the layer touching it, weighted by `SLOT_AREA` (torso .36, legs .40, feet .10, head .09,
  hands .05). It used to be an unweighted mean over *garments*, where a wet hat counted as much as
  a wet coat and putting on more clothes changed the number without changing anything physical.
- **Bare skin still gets wet**, per slot now — a hood keeps your head dry while your boots fill.
  Skin wets at whatever the stack lets through and dries 8× faster than cloth (~7 min
  soaked-to-dry outdoors), held in RAM since skin has no inventory row. Skin *under* cloth dries at
  only 1.5×, which is the honest reason to take a wet coat off. The old flat `wetness = 0` meant a
  naked player in freezing rain took the −15 exposure penalty and none of the ×2 wet cooling
  multiplier — stripping off was a way to shrug off a storm.
- **Drying is proportional, wetting tapers.** `dryStep` sheds in proportion to the water left (fast
  first half, long damp tail) instead of subtracting a flat rate that dried the last 10 points as
  fast as the first 10; `absorbStep` tapers toward saturation instead of slamming into the clamp.
- **Sleepers get rained on**, and a dreamer's *body* does too (`bodyZoneOf`, not `current_zone`).
  They just get no wetness messages — they're asleep. Cold is what wakes them.

## Rates
Rain is `precipRate^1.4 × 34` per minute on the **outermost** layer, × up to 1.6 for wind-driven
rain. Time for an exposed garment to go bone-dry → soaked: light (0.3) ~20 min, moderate (0.5)
~10, heavy (0.65) ~7, torrential (0.95) ~4. The old `precipRate² × 30` curve suppressed the bottom
of the range so hard that light rain took 37 minutes, and it's the light-to-heavy band this lifts —
torrential is deliberately left where it was. Snow keeps its piecewise curve including the
blizzard dry-wind cap, and is **not** wind-driven: blown dry snow is the one case where a gale
wets you less.

## What consumes `player.wetness`
The engine's body-temperature drift, two ways: as a **rate multiplier** (soaked ≈ 2× cooling) and — since 2026-07-29 — by **degrading `insulation` itself**, everything except the `hydrophobic` share. That second one is why a rained-on hoodie is now genuinely dangerous and a wet wool scarf is not.

## See also
Wetness also arrives from submersion (**swimming**) and is removed by **laundry**. The body-temperature
drift that consumes `player.wetness` is engine-side — see
[systems-survival.md](../../docs/systems-survival.md#body-temperature--thermal-comfort).
