# fireworks

**Purpose** — an admin-triggered synchronised fireworks show over the clone facility. Deliberately multi-channel, because a firework should reach you however you are experiencing the world:

- staggered burst descriptions at the origin **and** nearby rooms, fainter with distance
- propagated booms through the sound system
- screen flashes on foot
- real 3D bursts out the windshield if you are airborne
- a weather-FX sky glow underneath all of it

## Commands
- `fireworks` — admin only.

## Registered actions

- `fireworks.launch` { zoneId, seconds }: the same show from another system. The broadcast plugin calls it when a final is crowned, from the tile its park's venue stands on. Refused while a show is running.

## Notes
The flight-sim path and the on-foot path are mutually exclusive by design: an airborne viewer gets the real burst, not the flat flash.
