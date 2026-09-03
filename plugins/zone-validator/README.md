# zone-validator

**Purpose** — world integrity. Validates zone exit connectivity, and detects and repairs broken exits.

This is the plugin that keeps the map honest as it grows: an exit pointing at a zone that no longer exists is caught here rather than by a player walking into it.

## Hooks
- `worldValidator.runFull` — sweep everything.
- `worldValidator.runZone` — one zone.
- `zone.create`, `zone.update` — validate on write.

## Commands
None — it runs on the hooks.

## Note
`zone.create` **strips dangling exits**, which is why bulk zone construction needs the exits to exist on both sides before they will stick.

That stripping is also why `runZone` resolves exit targets against `world.zones` **and falls through to the DB on a miss**. It is on the write path of every zone save, so the id set it used to fetch (`SELECT id FROM zones`, 17k rows, ~0.5MB) was billed once per painted tile; but a memory miss read as an answer would delete the exits of a grid that is in the table and not yet in the Map. Fail closed. `regress.js` pins it.
