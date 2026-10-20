# furnishing

**Purpose:** players furnish the rooms they control: a flat they rent, their corp's HQ (with the manage-HQ permission) or a storefront they own. `place <item>` sets a carried furniture item down as a piece; `take <piece>` picks your own piece back up as an item. When a property is released (moved out, evicted, repossessed, HQ torn down) every piece a player placed there is boxed back into that player's inventory, with whatever was stored inside it.

Buying is in the engine ([furniture-shop.js](../../server/engine/furniture-shop.js)). A vendor delivers to one of your flats as before, and adds "Carry it out yourself" only when the piece wouldn't leave you too heavy to walk (14 kg plus 1 kg per Brawn point). With no flat, a light piece is carried and a heavy one is refused.

## Commands
- `place <item>`: put a carried furniture item down in a room you control. A room holds at most 12 player pieces.

## Specialized actions
- `take <piece>`: only for a piece you placed. Refused while someone sits on it, while a container piece has anything in it, or when it would leave you too heavy to walk. Anything else falls through to the engine's `take`.

## Events
- Consumes `property.released` (`{ zoneId, ownerId, kind }`), emitted by `releaseApartment` (flats and corp HQs) and by the storefront plugin's `releaseShop`.
- Emits `inventory.changed` after every place, take and boxing.

## Rules worth knowing
- **Placed rows survive restarts and deploys.** They're written to Postgres through the `world.js` funnel and reloaded at boot. Ids are `furn_<8hex>` with `origin='player'`, which the content export and import's deletion pass both skip.
- **Delete before give, consume before insert.** `take` deletes the row (scoped to your `owner_id`) before handing the item over, and `place` uses up the carried row before inserting the piece, so a doubled command can't duplicate anything.
- **What a piece turns back into** is `flags.item_id`, stamped at placement. Pieces bought before this plugin have only the item's name, which `itemForPlacedPiece` matches exactly; a piece that matches nothing can't be taken, and is dropped on release.
- **Boxed pieces land even when they're heavy.** The engine's rule is that you can hold the weight but you can't walk with it, so a player can wake up to a sofa in their pack and has to `drop` it or `place` it. A placer with no `players` row gets nothing back.
- Only `object_type` `furniture` and `container` are touched. Generators, media decks, posters, terminals, security devices and dead drops have their own verbs and teardown.
- **No ticks.** Every write is a typed verb or a release, and room text keeps reading the cache.
