# vale-apology

**Purpose** — a single, one-time narrative beat. Sergeant Vale (`npc_pd_officer`) was
auto-homed into a player-owned Embassy unit (Akerson's Unit 1A / `zone_apt_1`) while she
got back on her feet. Her real home is now Unit 2B (`zone_apt_6`). The first time Akerson
shares a room with her, she apologises for crashing at his place, thanks him, presses
₵200 into his hand (a real credit transfer), and moves out to her own unit (a real,
persisted NPC move). It fires exactly once, forever.

## Registered actions
None.

## Events emitted
None.

## Events consumed
- `zone.entered` — when the entering player is Akerson (matched by ownership of
  `zone_apt_1`, with a handle/username fallback) **and** Vale is standing in the room he
  entered, plays the one-time apology scene: spoken apology + thanks, a ₵200 payout via
  `adjustCredits`, then relocates Vale to `zone_apt_6` and persists her `zone_id`/`home_zone`.

## Tick usage
None — purely event-driven.

## Dependencies
- `economy` (`adjustCredits`) for the ₵200 transfer.
- Reads `world.apartments`, `world.npcs`; moves the NPC via `moveNpcToZone`.

## Config
None.

## Data schema
Owns no tables. Writes a single persistent `world_flags` row (`vale_apology_akerson`)
as the never-replay guard, and updates the existing `npcs` row for Vale when she moves.

## Extension points
None. Deliberately hard-wired to one NPC and one player — this is content, not a mechanic.

## One-time guarantee
Two layers: a persistent `world` flag (`vale_apology_akerson`) that survives restarts, and
a synchronous in-memory latch set the instant the trigger matches, so two rapid
`zone.entered` events in the same process can't both fire the scene. If Akerson leaves
mid-scene the ₵200 and the move-out still complete; only the spoken lines are gated on his
presence.
