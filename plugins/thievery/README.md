# thievery

**Purpose** — picking a live player's pockets. A **Deception** check against them, with a persistent 60-second cooldown held in the flag store (persistent, so relogging does not reset it).

## Commands
- `steal <player>`

## Discovery gap (structural)
Examine on a player never surfaces `steal` — the engine hardcodes only `look`, plus loot/attack/pinch for sleepers. This one is **inherently** invisible on examine and is known by the verb alone, which is arguably correct for a crime.
