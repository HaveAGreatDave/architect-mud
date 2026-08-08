# birthday

**Purpose** — every player has a birthday, and it is the calendar date their account was created. `birthday` is the only thing in the game that will tell you yours. On the day itself it also hands you a free **MANY HAPPY RETURNS** soylent pouch (`item_soylent_manyhappy`), once per calendar year.

## The three decisions

**Derived, never stored.** The date is computed from `players.created_at` every time it is asked for. There is no birthday column and no birthday flag holding the date — so there is nothing to backfill for the accounts that already exist, and nothing that can drift out of step with the account it belongs to. Every player has always had one; nobody has been told.

**Hidden by default.** It appears on no sheet, in no panel, in no `examine`. That is what makes the verb worth typing, and it leaves the reveal available to whatever is built on this later — a card that prints it, an NPC who remembers it, a shop that knocks something off. The intended growth path is that *something else* tells you, and the verb is just the floor.

**The real calendar, not the game one.** The game clock is accelerated, so a game-year birthday would come round every few days and stop meaning anything. This is the anniversary of a real date, which is also the only reading of "the date your account was created" that is actually true.

## The gift

`GRANT_ITEM` with `once: false` — you should get this year's pouch whether or not last year's is still in your bag. The claim is tracked in `player_flags` as `birthday_gift_year`, holding the **year** rather than a boolean, so the check is a comparison and not a reset somebody has to remember to run.

## Leap days

An account created on 29 February keeps that date on the sheet and celebrates on 1 March in a year that hasn't got one. Without this, a leap-day player goes three years in four with no birthday — cute the first time, a bug every time after.

## Commands
- `birthday`

## See also
- [content/items/item_soylent_manyhappy.json](../../content/items/item_soylent_manyhappy.json) — the pouch
- [plugins/vending/README.md](../vending/README.md) — the ordinary soylent flavours, dispensed at Second Helpings
