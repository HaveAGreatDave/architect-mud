# drama

**Purpose** — dramatic entrances. A player writes one line, arms it, and the **next** room they walk into gets that line instead of the usual "arrives from the south". `$player` stands in for their handle.

**One-shot**: firing it disarms. That is what stops it being a permanent custom move message and keeps it an *event*.

## Commands
- `drama` — write and arm the line.

## Hooks
- `movement.arriveMessage` — where the substitution happens.

## Discovery
Self-targeted authoring command; there is no world object to hang it off, so it is not examine-surfaced.
