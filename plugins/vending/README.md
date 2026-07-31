# vending

**Purpose** — dispenser furniture. `vend` pulls a data-driven item from a machine in the room, drops it in your bag, and coughs a line to the room. Free institutional food and the like — and reusable for any dispenser.

## Commands
- `vend`

## Data-driven
The machine's `flags.vends` carries the item id. A new dispenser is content.

## Discovery gap (known)
This is a **flag-value** gate, not a tag, and `availableActions` cannot surface flag values — so the machine's description has to cue the VEND button. Same structural class as `synthesis`'s `cook`.

## Depends on
**appliances** — an unplugged machine does nothing.
