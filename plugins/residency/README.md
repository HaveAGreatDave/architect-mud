# residency

Residents-only rooms, as a one-gate law.

Put `flags.residents_only: "<building name>"` on any interior tile and it can only be
entered by a player who holds a unit in that building. Residency is resolved by the
engine's `isResidentOf()` (`server/engine/apartments.js`) over the in-memory
`world.apartments` cache and the same `getBuildingName()` every other caller uses — so
the check is synchronous and adds no DB round trip to a step.

## Flags

| Flag | Meaning |
|---|---|
| `residents_only` | Building name a player must hold a unit in to enter. |
| `residents_only_deny` | Optional refusal line, in the building's own voice. Defaults to a generic "Residents only." |

`admin`/`dev` roles walk through.

## Elevators

A floor selection is a teleport, not a step, so the **elevator** plugin runs the move-gate
chain itself before it seals the doors — a gated floor is refused at the panel. Nothing to
author: put the flag on the destination zone and both doors and lifts honour it.

## Shipped use

The **Solenne Residences** private roof helipad (`zone_solenne_helipad`). The tower's own
airfield tile additionally carries `airfield_residents_only`, which the flight plugin reads
in `fieldFor()` so an outsider standing on the street can't rent a bay or use the pad's
services either.
