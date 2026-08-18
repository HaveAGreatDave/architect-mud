# birthday

**Purpose** — every character has a commencement date on the world's own calendar, and an age that follows from it. `birthday` is the only thing in the game that will tell you yours. On the day itself it also hands you a free **MANY HAPPY RETURNS** soylent pouch (`item_soylent_manyhappy`), once per game year.

## The four decisions

**The game calendar, not the real one.** A person living in 2076 does not have a birthday on a calendar nobody in the world can see. The date is a `world_clock.game_date` one, and the age is a real number of in-world years — the only reading that means anything to somebody standing in Coldwater.

**Twenty-five, from the vats.** A character commences at 25. It is not derived from anything and is not meant to be: it is why every tank-grown adult in this city walks out fully formed with no childhood to discuss.

**Derived from the ACCOUNT, extrapolated through the clock.** `players.created_at` is a real unix timestamp and the world runs at `world_clock.time_scale` game-days per real day (3, currently), so the in-world date an account was registered is today's game date minus *(real days since registration × scale)*. The commencement date is twenty-five years before that. This is what stops a month-old character being told their birthday is today, and it is why an account a year old reads as 28 rather than 25.

**Latched once, not recomputed.** The scale is a knob that has changed and will change again; recomputing on every ask would slide a character's birthday every time somebody touched the dev panel's game-speed slider. So the extrapolation is done once — against the scale in force at that moment — written to the `birth_date` player flag, and read from there forever after.

## The re-latch

`birth_date_basis` records which rule wrote the stored date: `account` for the extrapolation above, `unknown` for an account whose `created_at` could not be read (which falls back to today-minus-25, and is stamped anyway so it does not recompute on every ask).

A stored date with **no** basis against it is a row from the first version of this plugin, which latched today-minus-25 for everybody and so made every existing character's birthday the day they first typed the verb. Those are re-derived from the account once, on the next ask, and stamped. That is the only circumstance in which a latched value is overwritten — and the date and its stamp are written in a single call, because a date that lands without one is indistinguishable from a pre-re-latch row and would be rewritten again.

## Hidden by default

It appears on no sheet, in no panel, in no `examine`. That is what makes the verb worth typing, and it leaves the reveal available to whatever is built on this later — a card that prints it, an NPC who remembers it, a shop that knocks something off. The intended growth path is that *something else* tells you, and the verb is just the floor.

## The gift

`GRANT_ITEM` with `once: false` — you should get this year's pouch whether or not last year's is still in your bag. The claim is tracked in `player_flags` as `birthday_gift_year`, holding the **game year** rather than a boolean, so the check is a comparison and not a reset somebody has to remember to run.

## Leap days

A 29 February commencement is walked back to the 28th at the latch, rather than kept as a date the calendar refuses three years in four. Nobody is attached to it and nobody has been told it yet, so the moment to fix it is before it is written.

## Commands
- `birthday`

## See also
- [content/items/item_soylent_manyhappy.json](../../content/items/item_soylent_manyhappy.json) — the pouch
- [plugins/vending/README.md](../vending/README.md) — the ordinary soylent flavours, dispensed at Second Helpings
- [server/engine/gametime.js](../../server/engine/gametime.js) — the game-speed knob the extrapolation multiplies by
