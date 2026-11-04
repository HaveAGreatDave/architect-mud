# roomstage

**Purpose:** walk round a flat in first person. `room` opens the Room Stage in any flat, or in any room carrying `flags.room`; the tenant and visitors alike can open it, and everyone in the room sees everyone else. It's the shared layer the Platinum Box suite walks on too ([docs/proposals/room-stage.md](../../docs/proposals/room-stage.md), [docs/proposals/home-stage.md](../../docs/proposals/home-stage.md)).

## Commands
- `room`: open the room in 3-D. Refused where there's no room to walk round, and at the log display rung.
- `room close`: shut it. Walking out of the room shuts it too.
- `arrange <piece> <wall>`: move one of the room's player pieces against another wall: `left`, `right`, `window` (or `front`) or `door` (or `back`). `arrange <piece>` with no wall puts it back where `place` would set it now. Anyone who controls the room may (its tenant, a corp's HQ manager, a shop's owner: furnishing's `place` rule); an authored piece refuses ("It's fixed in place."), and so does a piece somebody is sitting or lying on. Works at every display rung: the room text doesn't change, only `flags.spot`.

## The payload
`room_view` is the whole room: `spec` (`{ w, d, h, unit, door, window }` in metres), `pieces` (`{ id, name, arche, form, dims, spot, wear, seed, verbs, container }`), `people` (`{ id, name, posture, on, at?, yaw?, seat?, npc?, order? }`, where `order` is an NPC's order id when it has one, which the client dresses as that order dresses: a Wildblood in the tunic and mantle, docs/proposals/hd-figure.md), `mine` (whether you control the room) and `clock` (the server's fractional hour, for the light through the window). After it, `room_piece` sends one piece placed or taken (or, with `pieces`, the whole room after a move-out) and `room_people` who's there now.

## Events
- Consumes `furniture.changed` (`{ zoneId, id, gone }`), emitted by the furnishing plugin's `place`, `take` and move-out boxing, by a vendor's delivery in `server/engine/furniture-shop.js` and by this plugin's own `arrange`.
- Consumes `room.pos` (`{ playerId, at, yaw, seat }`), which `server/index.js` emits for a client's `room_pos` message.
- Consumes `zone.entered`, `posture.changed` and `player.logout` to keep the people current.

## Rules worth knowing
- **The Stage decides nothing.** Every gesture sends a verb a player could type: `sit <piece>`, `lie <piece>`, `stand`, `open <piece>`, `watch <piece>`, `examine <piece>`. The room text and the text rungs lose nothing, and a posture typed in the log moves you on the Stage, because your own posture comes back in `room_people`.
- **A piece's look comes from data.** `archetypeOf`, `formOf` and `dimsOf` in `client/shared/room-layout.js` read the item's flags and weight (a deep-freeze is a chest, a heavy lie-only piece is a pod); `flags.look` (`{ arche, form, dims, wear }`) overrides any of them. Nothing reads an item's name.
- **A player's spot is stamped once, then moved only by `arrange`.** `flags.spot` (`{ wall, along, turn }` or `{ at: [u, v], turn }`, in metres) is written to the row when it lands. `arrange` takes the first free candidate on the named wall from `placeSpot` (its `wall` option) run over the room without the piece, so the way in from the door, the window and the overlap test still decide; a full wall refuses. It's one `updateFurniture` write, then `furniture.changed`, so everyone with the Stage open gets `room_piece` and sees the piece move. An authored piece is never written to, since git is the only writer of content; its spot is worked out by the same rules every time, before any player piece, so it doesn't move either.
- **Positions are RAM.** The client sends `room_pos` when you stop walking or sit, not every step, throttled to one per 150 ms per player. A restart forgets them and everyone starts by the door.
- **No ticks, no hot-path queries.** `zone.entered` and `posture.changed` return on one `Map.get` unless someone has that room open. The only writes are the spot stamps and `arrange`'s one write.
