# vending

**Purpose** — dispenser furniture. `vend` pulls a data-driven item from a machine in the room, drops it in your bag, and coughs a line to the room. Free institutional food and the like — and reusable for any dispenser.

## Commands
- `vend`

## Data-driven
The machine's `flags.vends` carries the item id. A new dispenser is content.

## Some dispensers fill what they hand you
A machine carrying `flags.vend_drink` doesn't hand over an empty vessel — it makes the cup **and** what goes in it, and charges. An espresso rig was a cup dispenser that then expected you to produce your own grounds and brew them at it, which is not what a person does at a coffee machine.

This plugin knows nothing about what a drink is. It inserts the row as it always did, offers that row to the **`drinks.serveVended`** Action, and prints whatever comes back beside its own line. Everything else — the recipe, the quality band, the heat, the price — lives in `plugins/drinks`, which is the only thing allowed to touch a vessel's `custom_data`.

Three rules fall out of that:
- **A machine with no `vend_drink` is untouched**, and so is a world with the drinks plugin unloaded: the dispatch is guarded, the fill answers `undefined`, and you get an empty cup exactly as before.
- **A refusal undoes the dispense.** You couldn't afford it, so you never had it — the row is deleted rather than left in your bag as an empty cup you didn't ask for.
- **The cooldown is armed last**, so a machine that wouldn't serve you hasn't started its minute either.

The cooldown default is **derived from whether the machine makes anything**: 60s for a rig that has to pull a cup, 20s for one that drops a packet. A sixth espresso rig authored next year gets the minute without anybody remembering to type it, and `flags.vend_cooldown_s` still overrides both.

## VEND shows on examine
One declaration-only specialized action (`requiredFlag: 'vends'`) puts VEND in the machine's action list and on its examine line, so a dispenser no longer only works for a player who already knows the word.

This sat filed as a permanent KNOWN GAP for a long time, on the grounds that `availableActions` cannot read flag VALUES. That is true and beside the point: **`requiredFlag` gates on the flag KEY**, which is all a dispenser needs. Worth remembering next time something is filed as ungateable — `synthesis`'s `cook` was filed as the same structural class and may not be one either.

A rig that serves a drink says more than the verb: `plugins/drinks` hangs a `furniture.describe` line off it naming the drink, the band and the price, quoted by the same function that takes the money.

## Depends on
**appliances** — an unplugged machine does nothing.
