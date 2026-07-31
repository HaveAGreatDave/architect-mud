# jail

**Purpose** — what happens when you go down while wanted. You respawn in Precinct 9 holding rather than at a clone vat, serve **one minute per star**, have your gear confiscated into an evidence locker, and get walked out by a guard at the end of it.

## Commands
- `sentence` / `time` — how long you have left.
- `conceal` / `concealresolve` — hiding something before they search you.

## Specialized actions
- `read` on anything tagged `charge_sheet`.

## Hooks
- `player.respawnZone` — **the seam that makes this work.** Jail does not intercept death; it answers the engine's question about where you come back.

## Actions
- **Consumes:** `WANTED_RAISE` · `WANTED_PEAK` · `WANTED_CHARGES` · `WANTED_CLEAR` · `TELEPORT` · `CHARGE_CRIME`
- **Provides:** `ARREST`

## Events consumed
- `zone.entered`, `player.logout`

## Ticks
- **hourly** — evidence purge.
- **1m** — shift rotation and the wanted-decay HUD.

## Load order
`after: ["surveillance", "doors"]` — surveillance owns the stars, doors owns the hackable cell door.

## See also
[docs/systems-jail.md](../../docs/systems-jail.md)
