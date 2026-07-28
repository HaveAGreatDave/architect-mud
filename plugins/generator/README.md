# generator

**Purpose** — portable fuel generators, for when the grid is down and you would rather not wait. Deploy a unit, refuel it from a fuel can, connect it to a building's junction box, and back-feed power into the building.

## Commands
- `generator` / `gen` — the control hub: start, stop, pack, disconnect, status.
- `connect` / `plug` — wire a deployed unit into a junction box.
- `refuel` — top it up from a carried can.

## Specialized actions
- `deploy` — set the unit down.

## Hooks
- `furniture.describe` — the deployed unit's status line.

## Also owns `plug`
The **appliances** plugin owns `unplug` but not its inverse; `plug` falls through to this plugin's `togglePluggedByName()`, because `plug` was already taken here for junction boxes.

## Discovery gaps (known)
Every verb here acts on a **deployed `generator_portable` furniture**, which carries no tag or interactions, so examine has no branch for it. Discovery is the deploy confirmation plus the `furniture.describe` status line. Recorded as an accepted gap in the manifest.
