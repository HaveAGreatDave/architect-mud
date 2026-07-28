# fillable

**Purpose** — fluid containers. FILL at a water source, DRINK to restore thirst, EMPTY to discard. Gated on the `fillable` capacity tag.

## Specialized actions
- `fill` · `empty` · `drink`

## Ordering note
**drinks** deliberately claims `drink` before this plugin, so a cup holding a mixed drink is not treated as plain water. The `holdsDrink()` guard here is the ordering-independent backstop for that.

## Commands
None.
