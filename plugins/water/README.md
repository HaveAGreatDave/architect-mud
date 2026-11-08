# water

**Purpose** — the water domain. DRINK from furniture, gated on the `water_source` capability tag.

## `drink water`

The bare word names no source, so the plugin looks for the easiest clean water without leaving the room, in this order:

1. A carried container of water. **fillable** owns that schema and answers through `fillable.drinkCarriedWater`.
2. A carried `potable` item. It comes after containers because drinking it spends it.
3. Water-source furniture in the room.
4. The room itself, for a transient zone with `water_source` on its flags.

It skips toilets, flushed or not, and anything **bodily** reports as fouled. If nothing is left it says so. Naming a source still works, so `drink toilet` drinks the toilet.

## Specialized actions
- `drink`

## Commands
None.

## See also
**fillable** for carried containers; **drinks** for anything you actually made.
