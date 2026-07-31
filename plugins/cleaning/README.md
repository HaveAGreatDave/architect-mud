# cleaning

**Purpose** — mopping the floor. The engine could already stain a room and describe its stains, but only the nightly sweep could remove them — and **owned rooms no longer get that sweep** (`server/engine/zone-filth.js` keeps a player's own space dirty for a full rent cycle). So somebody has to do the work, and that is what makes carrying a mop worth it.

This is the floor half of a pair; the body half is the hygiene substrate.

## Commands
- `clean` / `mop` — clean the floor you are standing on.

## Tool vs. hands
- A tool tagged `cleaning_tool` — **carried, or a fixture already in the room** — clears the whole floor in one go.
- **Bare hands** clear one patch and leave the filth on *you*.

Either way the work costs sweat through the hygiene substrate, so a proper scrub earns you a shower afterwards. That loop is deliberate.

## Cost model
**No table, no tick, no skill.** Stains live in RAM on the zone, so a clean is a synchronous mutation — this plugin adds nothing to the DB or the tick budget.

## Extension points
- `items.tags.cleaning_tool`
- `furniture.tags.cleaning_tool`

## See also
[docs/systems-cleaning.md](../../docs/systems-cleaning.md)
