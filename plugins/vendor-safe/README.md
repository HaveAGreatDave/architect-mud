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
