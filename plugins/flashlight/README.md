# flashlight

**Purpose** — a battery-powered handheld light the player carries. Owns the `light` / `unlight` / `reload` verbs for items tagged `flashlight`, and the per-player perception boost that lets a lit flashlight make an otherwise dark room readable. Light and its battery are *item state*, not zone infrastructure — the zone's own lighting (streetlights, fixtures, windows) is untouched; only how brightly the holder perceives the room changes.

## Registered actions

Specialized (tag-gated on the `flashlight` class tag; target self-resolved from inventory):

- `light` — switch the flashlight on. Fails if it's already on or the battery is dead.
- `unlight` — switch it off.
- `reload` — consume one `battery` item from inventory to refill the cell to full.

## Events emitted

None.

## Events consumed

None.

## Hooks consumed

- `visibility.perceive` (fired by `describeZone` in `server/engine/commands/describe.js`) — if the player holds a lit flashlight with charge, raises their perceived visibility to at least the `clear` band (fairly visible). No-op when the room is already that bright or brighter.

## Tick usage

- `1m` — drains one charge unit from every lit flashlight held by an online player. At zero the beam dies (`lit` → false) and the holder is warned.

## Dependencies

Engine: `environment.js` (`floorVisibility`, `LIGHT_LADDER`), `scheduler.js`, `messaging.js`, `world.js` (`getAllLivePlayers`).

## Config

- `BATTERY_MAX = 120` — charge units on a fresh cell (1 unit/minute ⇒ ~2 hours of light).
- `LIT_FLOOR = 'clear'` — the light band a lit flashlight guarantees the holder.

## Data schema

No owned tables. Instance state lives in `player_inventory.custom_data`: `{ lit: bool, battery: int }`.

Item content (created by `scripts/seed-flashlight.js`):

- `item_flashlight` — `flashlight` (marker), `unique` (per-instance state), `misc`.
- `item_battery` — `battery` (marker), `misc`. Stackable consumable.

## Extension points

The `visibility.perceive` hook is a general per-player perception seam: any plugin can return an adjusted visibility object (e.g. night-vision cyberware, a flare) and it composes with the darkness gating in `describeZone`.
