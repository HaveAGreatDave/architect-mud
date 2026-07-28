# prologue

**Purpose** — the pre-world tutorial. New souls spawn in The Inbetween and walk a **one-way corridor** before they ever reach Coldwater:

1. **Chargen** at the MORPHEX terminal.
2. The **holosign** — first Architect Interface IP, your tablet, and your holocaster.
3. An **eerie welcome broadcast**.
4. Collapse into the Coldwater clone vat.

Move gates hard-gate the three narrative doors; the void rooms are lit by the engine's `zones.flags.always_lit` property rather than by fixtures.

## The two beats outside the corridor
- **Post-vat onboarding:** after your first kill, Grady points you at his armchair — which is how you learn that sitting heals.
- **Out-of-fiction:** on a first login it asks whether you have ever played a multiplayer text game. If not, the client runs a spotlight tour of the interface. `tutorial` replays it.

## Commands
- `tutorial` / `intro` — replay the tour.
- `introdone` — the client's echo that the cold open has finished. **Load-bearing:** the prologue holds all arrival prose until it arrives.

## Specialized actions
- `use`, `read`

## Events consumed
- `appearance.changed` · `posture.changed` · `zone.entered` · `enemy.killed`

## Load order
`after: ["cosmetic-machine", "interactions", "tablet"]` — the corridor drives all three.

## See also
[docs/systems-codex.md](../../docs/systems-codex.md) — the 30-second cold open plays *before* the prologue speaks.
