# flashlight

**Purpose** — a battery-powered handheld light the player carries. Owns `turn on/off flashlight`, the `flashlight` toggle and the `reload` verb for items tagged `flashlight`, and the per-player perception boost that lets a lit flashlight make an otherwise dark room readable. Light and its battery are *item state*, not zone infrastructure — the zone's own lighting (streetlights, fixtures, windows) is untouched; only how brightly the holder perceives the room changes.

## Registered actions

Specialized (tag-gated on the `flashlight` class tag; target self-resolved from inventory):

- `turn on flashlight` / `turn flashlight on` (also `switch`, and `torch`) — an input matcher, since `turn` belongs to furniture and flight. Fails if it is already on or the battery is dead.
- `turn off flashlight` — switch it off. `flashlight` alone toggles; `flashlight on|off` is explicit.
- `reload` — consume one `battery` item from inventory to refill the cell to full.

## Events emitted

None.

## Events consumed

- `player.login`: one read for the player logging in: do they still hold a lit flashlight from the last session?
- `item.taken`, `item.given`: a lit flashlight picked up or handed over puts its new holder on the drain list. No read; the event's row carries `custom_data`.

## Hooks consumed

- `visibility.perceive` (fired by `describeZone` in `server/engine/commands/describe.js`) — if the player holds a lit flashlight with charge, raises their perceived visibility to at least the `clear` band (fairly visible). No-op when the room is already that bright or brighter.

## Tick usage

- `1m` — drains charge from every lit flashlight held by an online player, at a per-item rate (`flashlightDrainRate`): the stock 1 unit/min, or slower for a frugal light (see Config). Fractional drain accumulates in `custom_data.drainacc` so `battery` stays an integer. At zero the beam dies (`lit` → false) and the holder is warned.
  It reads only the players on an in-memory list of who might have a light on (`litHolders`), and does nothing when the list is empty, so a world with every light off costs no queries. A player joins the list when they switch a light on, log in holding a lit one, pick one up or are handed one, or when `visibility.perceive` finds one (the catch-all for moves that fire no event: a trade, a shop purchase, the Drake's stores). They leave it at `turn off` when nothing else they hold is lit, when the battery dies, once they log out, and when the tick finds nothing lit. A stale entry costs one read and then clears; a missing one would mean a light that never drains, which is why the adds are the generous side.

## Dependencies

Engine: `environment.js` (`floorVisibility`, `LIGHT_LADDER`), `scheduler.js`, `events.js`, `messaging.js`, `world.js` (`world.players`).

## Config

- `BATTERY_MAX = 120` — charge units on a fresh cell (1 unit/minute ⇒ ~2 hours of light).
- `LIT_FLOOR = 'clear'` — the light band a lit flashlight guarantees the holder.
- `flags.flashlight_drain` (per **item**, optional) — a positive drain multiplier. Absent/invalid ⇒ 1.0 (normal). `0.5` halves the drain, so a cell lasts ~twice as long (e.g. `item_lucky_flashlight`, Grady's gift).

## Data schema

No owned tables. Instance state lives in `player_inventory.custom_data`: `{ lit: bool, battery: int, drainacc: number }`.

Item content (created by `scripts/seed-flashlight.js`):

- `item_flashlight` — `flashlight` (marker), `unique` (per-instance state), `misc`.
- `item_battery` — `battery` (marker), `misc`. Stackable consumable.

## Extension points

The `visibility.perceive` hook is a general per-player perception seam: any plugin can return an adjusted visibility object (e.g. night-vision cyberware, a flare) and it composes with the darkness gating in `describeZone`.
