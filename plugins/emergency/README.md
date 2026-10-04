# emergency

**Purpose** — the Emergency Security Protocol: a zone-wide siren, warning broadcasts, and a red-alert UI state.

## REST
- `/emergency`

## Hooks
- `furniture.describe` — alarm panels report their state.
- `player.death`

## Events
- emits `esp.changed` `{ active }` when the ESP starts and when it stops. It's how another plugin
  hears that the city is locked down without importing this one: the South Lock drops its outer
  door on it (`plugins/trucking/lock.js`, `plugins/flight/state.js`).

## Commands
None — it is triggered, not typed.
