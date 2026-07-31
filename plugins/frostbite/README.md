# frostbite

**Purpose** — the cold injury `body_temp_c` cannot model. Core temperature asks whether the body
as a whole is winning; frostbite is what happens to the parts it SACRIFICES in order to keep
winning. Peripheral vasoconstriction is the first thing a cold body does and it works — the core
holds 37°C for hours while fingers, toes and ears freeze. Before this, standing in −30°C in a
superb coat could be done indefinitely at no cost.

## Commands
None — entirely passive, driven off exposure.

## Hooks
`tick.minute` — advances a 0–100 meter and swaps the stage's status effect.

## How it works
- **Skin temperature, not room temperature.** Reads the windproofed apparent temperature with
  **no credit for core insulation**: a parka does nothing for your fingers. Only what covers
  them counts, via `player.extremityExposure` (hands / feet / head), which is owned by
  `recomputeInsulation` — this plugin never reads inventory.
- **Onset −5°C, thaw above +5°C.** The gap stops the meter chattering at a boundary.
- **Full cover is slow, not immune** (`COVERED_FLOOR = 0.25`), so a hat isn't a checkbox that
  switches the hazard off.
- **Stages** frostnip (25) → frostbite (60) → deep (90), each a registered status effect taking
  −1/−2/−3 Reflexes. Stacks with the core cold penalty on purpose: hypothermic *and* dead-fingered
  is worse than either, and a body can be both.
- **Not while submerged.** Freezing tissue needs air below freezing; water that's still liquid
  isn't it. Cold water is a core-temperature problem, and a much faster one.

## Permanence — the point of the whole system
Frostnip and frostbite are **circulation** injuries: they thaw on their own at 0.4/min above 5°C
and need nothing from anybody. **Deep frostbite is tissue death**, and dead tissue does not warm
up and come back. Crossing 90 latches a **floor** there, and from then on the meter thaws *to*
the floor and stops. This is the only permanent injury in the game, and it's what turns the cold
from a timer you wait out into a thing you get treated for.

Two things undo it, and they buy different things:

| | Effect | Cost |
|---|---|---|
| **Field kit** (`tags.treat_frostbite {steps, floor}`) | Walks it back `steps` stages, **never clearing it** (`floor: 1`). Brings the floor down with it, or the next thaw would just drag it back up. | trauma kit 2 stages, medkit 1 |
| **Clinic** (`CLINIC_TREAT`) | Clears it outright, **floor and all**. | `frost_fee` × stage rank, default 60₵ each — dearer than a wound, because it's the one line on the bill the patient couldn't have waited out |

A kit buys back the use of your hands. Only a clinic buys back the hands.

## Persistence
`player_flags.frostbite` + `frostbite_floor`, written together on **stage change only** — tens of
minutes apart, not per tick. The meter is RAM and restores to the stage floor on relog: the injury
is worth remembering, the exact number isn't. The status effect is re-seated on hydrate, so a body
that logs back in maimed wears it immediately rather than looking healthy until the first tick.

## Not built: amputation
Deep frostbite penalises the hand; it never costs you the hand. Losing one would touch equip slots,
`extremityExposure`, and whether augments become the prosthetic answer — a project, not a tweak, and
deliberately out of scope.

## See also
[systems-survival.md](../../docs/systems-survival.md#body-temperature--thermal-comfort) for the core
model this sits beside.
