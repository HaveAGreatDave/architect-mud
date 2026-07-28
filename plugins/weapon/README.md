# weapon

**Purpose** — player-initiated combat. Marked `critical: true` in the manifest, and it is: this is the plugin that owns the swing.

- Attack **target resolution**.
- The **player swing**, including kill handling and corpse + loot creation.
- **Sleep-kills.**
- Combat **stances** (`fight`) and the `pow` / `dodge` moves.
- The **contested-flee move gate**.

## Commands
- `fight` — set your stance.
- `pow` / `power` · `dodge` — the moves.
- `flee` — contested; the move gate is here.
- `kamehameha` · `seppuku` — the joke ones, which are also real.

## Specialized actions
- `attack` · `kill` · `k`

## Registers
- the **ATTACK** Action.
- the **gameLoop auto-attack provider** — the seam that makes combat continue without a verb per swing.

## Events emitted
- `enemy.killed`, `enemy.attacked` — a great deal of the game hangs off these two (audio, quests, prologue, deaths, accolades).

## See also
[docs/combat.md](../../docs/combat.md) — to-hit, body parts, typed soak, cooldowns, enemy AI, loot.
