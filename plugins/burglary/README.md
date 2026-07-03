# burglary

**Purpose** — decides whether breaking into an occupied home actually earns wanted stars. A resident NPC has to *hear* the intrusion, and then either survive their panic cop-call or flee the unit to raise the alarm, before `burglary` is charged. Knock every resident out (kill them) before they finish, and no burglary star lands — though the assault/murder charge for attacking them still applies. With nobody home, breaching only charges burglary if a camera/cop/bystander witnesses it (the generic gate on `hololock.breached`).

## Detection model

- **Picking the door** (`breakin.attempt`, before the intruder is inside): an **awake** resident hears it at 100% and starts calling immediately; an **asleep** resident rolls **20% per 5s tick**. A **bashed** door (`method:'bash'`) is loud enough to wake sleepers on the spot.
- **Once inside** the unit: an asleep resident who stayed asleep rolls **3% per 5s tick** — unless the intruder makes **noise** (yell, say/talk, combat, a door bash), which wakes them instantly.
- **On detection** the NPC wakes (posture → standing), its normal AI graph is suspended (`_ai.alarm`), and it starts reacting with **escalating urgency**:
  - **While you're still picking the door** (intruder outside): defiant **yells through the door** every ~4s — *"I've CALLED THE COPS!"*, *"Get away from my home!"* — broadcast to the intruder's side too, so you hear them.
  - **Once you're inside**: frantic **screaming** every ~2s (denser + terrified) — *"SOMEBODY HELP, HE'S IN MY HOUSE!"*.
  - The resident keeps reacting for **as long as you're actually there**, and calms down (alarm ends) the moment you clear off.
- **The charge:** after the alarm has run ~10s (`CALL_MS`) **and the intruder has actually entered** the unit, `burglary.reported` fires (merely rattling the lock and leaving is at most an attempt — no charge). Attacked mid-alarm → the resident flees toward the entrance (per-tick dodge roll); clearing the unit also fires `burglary.reported`. Killed first → nothing reported.

## Safe-sleep forcefield gate
While a break-in is actively underway at a unit (the intruder is at the door or inside), the owner **cannot raise the safe-sleep quantum forcefield** — neither by `sleep`-ing nor by disconnecting to offline-sleep. This closes the "wall yourself off / DC to safety mid-burglary" exploit and makes the *player* being burglarized a real victim (they sleep exposed). Implemented as the `forcefield.gate` hook (below); the same intruder-presence check that drives the NPC alarms (`threatPresent`) is what the gate reads. The complementary direction holds in the engine: a door protecting an *already*-forcefielded unit refuses **both** the hack (at hack-arm and hack-resolve) and a physical `attack door` bash ([doors.js](../../server/engine/commands/doors.js) `doorForcefieldActive`) — the quantum shield is proof against brute force as well as the deck.

## Hooks
- `forcefield.gate` — `{ player, zoneId }` → returns a reason string to **veto** the forcefield (fired by `apartments.js` `activateForcefield`), or `undefined` to allow it. Vetoes whenever an active intrusion targets `zoneId` with the intruder present.

## Events emitted
- `burglary.reported` — `{ player, zoneId }` — a resident raised the alarm (call completed or fled the unit). The surveillance plugin charges `burglary` (forced witness) in response.

## Events consumed
- `breakin.attempt` — `{ intruderId, entranceZoneId, unitZoneIds, method }` (doors.js) — start/refresh an intrusion; wake awake residents (and, on a bash, sleepers).
- `player.spoke` — `{ player, zoneId, loud }` (social.js say/yell) — noise; wakes still-asleep residents at the unit.
- `player.attacked` / `npc.attacked` — combat noise; an attacked resident who is already alarmed switches to fleeing.
- `npc.killed` — cancels an alarmed resident's sequence (no charge).

## Tick usage
- `5s` — detection rolls for asleep residents, one flee step per fleeing resident, and stale-intrusion expiry. Panic-call lines and the call-completion charge are driven by `setTimeout` off the detection moment, not the tick.

## Dependencies
- **surveillance** — owns the actual wanted-star charge; this plugin only decides *when* burglary is reported.

## Data schema
None — all state is in-memory (intrusions + per-NPC alarm state), like the wanted runtime it feeds.
