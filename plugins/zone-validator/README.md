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
