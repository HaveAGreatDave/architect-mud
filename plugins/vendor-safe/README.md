# vendor-safe

**Purpose** — hackable vendor safes: the furniture holding a vendor's accumulated sale credits. Crack the combination through the VAULT CRACK dial minigame to drain it.

This is what makes a vendor's takings a real object in the world rather than an abstract number — rob the shop and the money was actually somewhere.

**A carried `hack_device` is required** — `hasHackDeck` from [hack-gear.js](../../server/engine/hack-gear.js), the same gate the ATM (`jack`), the hololock (`hack <door>`) and even the practice rig use. It was missing here, which made the vendor safe the one strongbox in the city you could open with your bare hands, and left `hack_penalty` / `hack_fail_damage` meaningless: *which* deck you carry is supposed to decide how hard the safe reads and what a bungled attempt costs. The check sits **after** the no-safe fall-through (`return undefined`) so a `hack` aimed at a door or an ATM in the same room still gets its turn, and **before** the lockout so an empty-handed attempt can't cost five minutes.

## Commands
- `safecrackresolve` — the minigame callback; never typed.

## Specialized actions
- `hack`

## Feeds
`vendor.safeHackWitnessed` → **surveillance**, as a forced witness.

## The night alarm

A vendor standing over their own safe used to be the **only** risk in cracking one: `vendorHere`
forces a witness and the wanted stars follow. Which meant the correct play against every safe in
the city was to come back at 3am — shop locked, owner asleep across town, nobody in the room.
Perfect information, zero risk, every time.

So the safe watches its own shop after dark. `alarmArmed(zone, vendorHere)` is true when the owner
**isn't** standing there and the day-phase is `night`/`dusk` — exactly the conditions that made it
free. Jacking in then trips the tamper circuit: a siren in the room, a line in every adjoining room,
any NPC asleep next door **on their feet** (`disturbSleeper`, forced), and the same
`vendor.safeHackWitnessed` forced witness a present owner is.

Three deliberate choices:

- **It fires at ARM time, not on success.** An alarm you only hear once the money's gone isn't an
  alarm, it's a receipt. Tripping it early is what gives the player the decision: crack it fast, or run.
- **Daylight with the owner out stays quiet.** A lunchtime break-in is a burglary you had to time,
  and the timing is the skill. Only the free window gets closed.
- **The `furniture.describe` tell reads the same `alarmArmed`**, so the red LED on the fascia can
  never promise a quiet safe that then screams. A trap you can't see before you spring it is a
  gotcha; a warning light is a decision. (It returns `undefined`, never `null` — `fireHook` takes the
  last non-undefined result, so a `null` blanks out another plugin's examine line.)
