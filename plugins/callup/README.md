# callup

**Purpose:** bring one of your vehicles out onto a depot's floor, where you walk up to it and climb in. Every depot keeps its vehicles somewhere you can't walk: the garage under a truck shed, the far bay of a hangar, the wet store behind a marina's water gate, the yard behind the racer bay. `callup` brings one out into the room you're standing in, and on the Room Stage it comes up through the floor, is towed in, floats in or is rolled in, and a key comes up when you stand beside it.

## Commands
- `callup`: with one vehicle of yours kept here, brings it out; with several, lists them. With none, says how to get one.
- `callup <vehicle>`: brings that one out, by its id, its number in the list or the start of its name.
- `callup back` (or `down`, `away`, `stow`): sends the one standing on the floor back. Only its owner can.

Climbing in is the seat's own verb, the one the counter's Deploy sends: `drive <id>`, `hangaract launch <id>`, `boat take <id>`, `podracer take <id>`. Doing it empties the floor at once.

## How it works
- **The stand is RAM** ([server/engine/vehicle-stand.js](../../server/engine/vehicle-stand.js)). A vehicle on the floor is a picture of where its row already is; no column moves. A restart puts everything back, and one left standing goes back on its own after half an hour. One vehicle a room; anyone in the room sees it, and only its owner can send it back or climb in.
- **Each vehicle plugin registers its kind** with `registerStandKind(kind, def)`: how to tell its bays (`flags.room.stand.kind` on the room, or the kind's own `isBay`), how to list a player's vehicles kept there (one query, on this verb only), the verb that boards one, and what the room says. The four kinds are `truck` (plugins/trucking, the shed's lift, whose `callup` is `hoist`), `aircraft` (plugins/flight, a hangar's tug), `boat` (plugins/powerboat, a covered slip) and `podracer` (plugins/podracer, the racer bay's dolly).
- **The Stage reads it** through the sync `room.vehicles` gather, which each of those plugins answers with `standVehicles(zone, player, kind)` for its own bays, and is told of a change by `room.vehiclesChanged` (plugins/roomstage). The client draws it with `client/game/js/panels/room-hoist.js`.
- **Where it stands** is the room's `flags.room.stand`: `{ kind, at: [u, v], face, len, wid, from, water }` in metres, `from` being `below` (a lift) or the wall it comes in through, and `water` a slip the walker can't step into. Without one it stands in the middle, a little back of halfway.

No hooks, no tick, no table.
