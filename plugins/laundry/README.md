# laundry

**Purpose** — the coin laundry. WASH your clothes at a washing machine. This is the other half of hygiene: a shower cleans the body, this cleans what you put back on.

## Commands
- `launder` / `laundry` — optionally naming a machine (`launder three`).

## Specialized actions
- `launder` — tag-gated on `washing_machine` furniture, so a machine advertises LAUNDER on examine and the handler self-resolves the target.

## Hooks
- `zone.furnitureOccupants` — reports a mid-cycle machine as taken, by furniture id.
- `furniture.describe` — a running machine says whose it is and how long is left. Silent when idle, so the **appliances** plugin's unplugged note survives (that hook is a `fireHook`).

## Authoring a machine
Any furniture with `flags.washing_machine`. Two optional numbers ride on the same row:

| flag | default | meaning |
|---|---|---|
| `wash_price` | `12` | credits, charged at the END of the cycle |
| `wash_cycle_ms` | `120000` | how long the drum runs |

## Three rules
1. **A machine is a place, not a capability.** The Wash was one furniture row that any number of people could run at once, which is not what a laundromat is. Four numbered machines now, and a running one is claimed for its cycle. The claim is runtime-only and keyed by furniture **id** — four machines in one room share a head noun and nothing else. The room reports it through the engine's occupancy line, the same one that says a booth is taken; this plugin writes no availability prose of its own.
2. **You have to take the clothes off.** The gate is `undress`'s own rule — the five body slots — so accessories stay on and the refusal names the verb that fixes it. It is checked after the money, so a broke player is not told to strip first.
3. **We charge at the end.** A wash interrupted by a restart simply didn't happen and the player keeps their money. That is also why the claim can be runtime-only: a restart forgets every claim, and forgetting one is the safe direction to fail.

## See also
**bodily** owns `shower`; **clothing-wetness** owns how they got wet in the first place.
