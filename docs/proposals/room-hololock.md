# The hololock in ROOM

**Status: built.**

A locked door in the Room Stage is a door you can see, with a hologram beside it that offers Unlock and Hack. Before this, a building's doorway was always an open hole: you walked into a locked one, waited 1.8 s and read "The door won't let you through."

## What you see

- **The door.** A doorway whose door carries a lock gets two steel leaves that meet in the middle, with a strip of light down the meeting edge. They slide into the wall when the lock lets you through and you come within 2.4 m, and shut 1.4 s after you leave, as the street's glass doors do. Shut, you can't walk through them.
- **The reader.** A small housing on the wall beside the doorway, on whichever side has room.
- **The hologram.** A card hung 17 cm off the reader: the lock's name, whose unit it is, a padlock, one word for how it stands, and its buttons. It's red for a door shut to you and green otherwise. A locked door that knows you reads UNLOCKED in green, since to you it is. The card is read from the room's side only, so it never shows mirrored through the wall it hangs on, and only with no wall between you and its door (`roomSees`): a flat's front door is down a hall beside the en-suite, and its card used to show through the bathroom from anywhere in the room. A long word (UNLOCKED) is set smaller so it stays on one line.
- **The plaque.** A unit's brass plaque (`decor.plaques`) is on the wall over the reader, centred on it, so the name sits above the card.

With Settings, Cel Shading, Comic on, the card is drawn in the house's comic look: one ink, flat colour, halftone dots, a hard offset shadow, and a sound word stamped over it when something happens (`CLACK!`, `KA-CHUNK!`, `DENIED!`, `LOCKED!`). With it off the same card is drawn in light alone.

## What it does

The card's buttons are the verbs you'd type, sent as typed:

| Button | Verb | Shown when |
|---|---|---|
| Unlock | `unlock door <dir>` | the door is locked |
| Hack | `hack door <dir>` | it's locked, the lock can be hacked and it isn't yours |
| Lock | `lock door <dir>` | the door is unlocked |

Stand within 2.3 m and face the reader, and `F` takes the first button and `2` the second, the same keys the room's other cards use. The buttons can be clicked too. The server's answer comes up on the card, so "The hololock doesn't recognize your credentials." is read where you're looking. A press that changes nothing within a second stamps `DENIED!`.

Nothing here decides anything. The engine's `engine:door-lock` move gate still refuses the step, `checkLockAuth` still says who may work the lock, and the hack still needs a deck and still raises what it raised before. See [systems-world.md](../systems-world.md#locks).

## The bypass

`hack` answers with `hololock_game`, as it always has. When the door is one of the room's, the client plays it on a wider board hung in front of the door instead of opening the overlay. Space sets a pin and Escape pulls the deck. Walking 3 m away pulls it too.

It's the same lock. [hololock.js](../../client/game/js/panels/hololock.js) has a skin seam (`setHololockSkin`, `startHololockGame`), which the `textgames` rung already uses; [room-lock.js](../../client/game/js/panels/room-lock.js) installs a skin that draws the pins on the board. Pin count, sweep speed, window width, miss penalty and the result through `hackresolve` are hololock.js's own, so the odds can't differ. The `log` and `textgames` rungs get their own boards as before, since the server marks those with `render`.

## How it's built

**Server** ([plugins/roomstage/index.js](../../plugins/roomstage/index.js)). `locksOf` reads each doorway the Stage cuts, finds its door (`doorOnLink`, or `frontDoorOf` for a street door) and, where the door has a lock tag, sends:

| Field | Meaning |
|---|---|
| `to`, `dir` | the room past the doorway and the way through it |
| `door` | the door's id, which `hololock_game` names |
| `locked` | the lock is engaged |
| `pass` | the move gate would let this player through now |
| `yours` | this player could work the lock |
| `hack` | the lock can be hacked |
| `owner` | whose unit the door is: the resident NPC, the tenant's handle or "Vacant". Absent on a door that's on no flat |

They ride on `room_view` as `locks`, and go again as `room_locks` when one changes. A lock worked by hand is sent at once, off `door.sfx` and `hololock.breached`. An NPC locking up, a shop's closing time and a lapsed rent write `lock_state` with no event, so a 5 s sweep compares a signature of each open room's doors and sends on a change. The sweep is RAM only; auth is async, so it runs only when something has changed.

`pass` comes from `lockedOnLink`, the move gate's drawn half, so a shop an NPC locked behind you still opens to let you out. A vacant flat's lock is vestigial and isn't sent.

**Client.** [gl/room-lock.js](../../client/game/js/panels/gl/room-lock.js) builds the leaves and the reader apart from the room's mesh, so a lock giving costs no rebuild, and [gl/room.js](../../client/game/js/panels/gl/room.js) draws them on a layer of their own (`setLocks`). [room-lock.js](../../client/game/js/panels/room-lock.js) owns the rest: the doors' slide, the holograms, the card's verbs and the bypass.

The hologram is a page, not a texture. Each frame the renderer projects the card's four corners and `quadMatrix` turns them into a `matrix3d`, so the words stay sharp and the buttons are real buttons. Furniture and people standing in front of it don't hide it, but it's hidden from behind its own plane (`face` on the panel) and by any wall on the plan between your eye and its door.

## Checks

- Check 12 in [scripts/shapes/room-stage.mjs](../../scripts/shapes/room-stage.mjs): a lock on every wall, the leaves filling the doorway shut and clear of it open, the card and board hung inside the room, a spot to stand at, and the verbs each state offers.
- The roomstage regress: a room's view carries its locks, a lock worked by hand is sent, the sweep catches one changed without an event and sends nothing otherwise.
- The Room Lab: `__labLock('<zone>')` locks the door to that room, `__labLock('<zone>', { locked: false })` gives it, and `__labHack('<zone>')` plays the bypass.

## Not built

- A room next door doesn't show this room's doors, so looking back through a doorway you came through, you see it open until you turn round.
- Bashing a door (`attack door`) has no button.
- The keycard, privacy bolt and Long Watch locks all show the same hologram. Each could have its own reader.
- A phone gets the card and its buttons, but nobody has tried the bypass on one.
