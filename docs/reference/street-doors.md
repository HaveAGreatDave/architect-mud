# Street doors: from the street into ROOM

> **Status: built (2026-11-16).** Every building with a Stage has one street door, drawn by one module whatever the
> building, fitted to the doorway its own model drew, with nothing of the model's still door showing round or through
> it. Six kinds of door. Gate: `scripts/shapes/street-doors.mjs`.

When you walk up to a building with a Stage in the street view on foot, its door opens for you (or waits for F), the
lobby shows through it, and stepping through is the ordinary `move <dir>` into ROOM. This doc is how that door is
placed, drawn and dressed, and what a new building needs to get one.

## The parts

| Part | File | What it does |
|---|---|---|
| The kinds and the look | `client/shared/street-door.js` | `DOOR_KINDS`, and how a room's `flags.room.street_door` names a kind (`streetDoorKind`), cuts the plan's doorway (`glassDoorOf`) and dresses the door (`streetDoorLook`). Server, plan and renderer all read this one file |
| The doors near you | `plugins/roomstage` `streetDoorsNear` | Each Stage building's door: its tile, edge, width, kind and look, sent with the map window |
| The doorway a model drew | `windshield.js` `markDoorway`, `markDoorwayAt`, `captureDoorways`, `doorBayAt` | Whatever draws a doorway records it; `doorBayAt` runs a tile's arm once to collect it |
| Fitting the door to it | `glass/doorway-measure.js` `measureDoorway` | Where the door stands, how wide and high, and the planes its leaves and backing stand in |
| Walking and opening | `freelook-view.js` (`doorway`, `footBlock`, `doorLeaves`, `doorShift`) | The doorway holds you until the door's open; the rooms behind it are moved to stand behind it |
| Drawing it | `glass/street-doors.js` | The backing, the leaves by kind, the runner, the frame for a door with no doorway of its own |
| The room through it | `gl/interiors.js` portals, `windshield.js` `streetPortals` | On the GPU, the building's rooms drawn through the doorway |

## One door, not two

A building's model draws its own still door, which is what you see from a cab or the air. On foot the moving door is
drawn over it as decals. Three things keep the model's door from showing round or through the moving one:

1. **The doorway is the model's own.** `windowBay` doors (authored or the kit's) and `drawEntrance` record
   themselves; an arm that draws its doorway by hand calls `markDoorway`. So the leaves fill exactly the opening the
   model drew: its centre along the front, its width, its threshold and its head. Without that, the door was fitted
   to the mass, and where an arm has no jamb mass it came out twice the room's width at the tile's middle: Screw It's
   1.2 m door was drawn 3.6 m wide, half a tile from its real door.
2. **The opening behind the leaves is always filled**, on the doorway's `back` plane, which stands in front of the
   model's glazing and leaves and is pulled toward the eye: by the room itself where the GPU draws it through the
   doorway (`portals`), otherwise by a backing card (the lobby's dim, the last still of the lobby, or black for a
   `dark` door).
3. **Leaves that swing in are projected onto the leaves' plane** along the line from the eye: the same place on the
   screen, but in front of the backing in depth. A swung leaf behind the plane was hidden by whatever filled the
   opening.

A door the model drew no doorway for (`fit: 'room'`) gets a frame of its own, jambs and a head in the trim colour, so
it's set in the wall rather than floating on it.

## How the doorway is resolved

`measureDoorway` tries, in order:

1. **`model`**: the model's recorded doorway on the front face (`doorBayAt`), the one nearest `street_door.cx` if it
   records several (Golden Goose Gardens has six glass doors). It must be tall enough to walk through (1.7 m); a
   building drawn to its own scale can have a doorway under a metre, and that one isn't the street door.
2. **`mass`**: jambs and a lintel measured in the captured mass, believed only when the gap is 0.6 to 1.6 times the
   room's door width and the lintel 1.9 to 7 m up.
3. **`room`**: the room's own width (`street_door.w`, or the opening the plan cut) on the measured wall, with a head
   of `street_door.h` or 2.4 m.

`node scripts/shapes/street-doors.mjs --list` prints each Stage door's fit, width, height and place along the front.

The rooms behind the door move with it: `doorShift` hands `interiorRoomsOf` the step from where the plan puts the
street door (the middle of the tile's street edge) to the doorway's middle and its `back` plane, so the lobby is
seen through the door and not beside it.

## Giving a building a street door

**Content.** The entry room's `flags.room.street_door` (see [flags-keys.md](../flags-keys.md)):

| Key | What it does |
|---|---|
| `kind` | `sliding`, `swing`, `single`, `revolving`, `plain` or `grille` (below). No kind is `plain`, or `grille` with `bars` |
| `w` | The door's width in metres, 1.2 to 3: the opening the plan cuts in the room's wall, and the street door's width when the model has no doorway |
| `h` | The head in metres, when the model has no doorway to read it from |
| `cx` | Tiles along the front: which of the model's doorways it is, or where it stands when the model has none |
| `hand` | A hinged glass door that stays shut from inside until F opens it |
| `glass`, `trim` | The glass's tint and the metal round each leaf, `#rrggbb` |
| `monogram`, `handle` | One or two letters on the pull plates; `handle: 's'` a cast S pull on a sliding pair |
| `leaf`, `bars`, `lite` | A plain door's colour; `bars` makes it a grille; `lite` is the glazed light in the leaf the room shows through: `porthole` (Voltage), `half` (the Shed) or `slot`, the default |
| `fanlight` | A glazed fan with bars over a hinged pair |
| `runner` | A carpet's colour, out across the pavement with a gilt edge |
| `dark` | Black behind the doors instead of the lobby, so the step in is a step into the dark the loading veil comes up out of |

**The model.** Nothing, if its door is a `windowBay` with `door` (authored detail or the kit's) or `drawEntrance`.
An arm that draws its doorway by hand adds one line where it draws it:

```js
markDoorway(F, x, wall, half, sill, head, front)   // F the arm's frame; wall the plane the door is in, front the reveal's face
markDoorwayAt(a, b, f, sill, head)                  // the same from world points, for an arm with its own frame (the Coliseum)
```

The Solenne, the Meridian, the Coliseum's Gates C and D and Golden Goose Gardens do this. `markDoorway` records nothing
outside a door capture, so it costs a frame one test.

**Check it** in the Modelshop: `__interiors({ zone: '<entry room>', outside: true, open: 0.5 })` stands you a tile out
from the door with the rooms drawn through it; `door: { kind: 'revolving' }` tries another kind, `mass: true` ignores
the model's doorway. Then run `node scripts/shapes/street-doors.mjs`.

## The kinds

| Kind | Leaves | Opens | Example |
|---|---|---|---|
| `sliding` | a glass pair sliding into the jambs | as you come up | the airport, the marina, the Solenne |
| `swing` | a glass pair in metal frames, hinged at the jambs, turning in | as you come up (`hand`: F from inside) | the Embassy, the Meridian, Screw It |
| `single` | one glass leaf across the opening | as you come up | |
| `revolving` | four glass wings on a post in a drum of curved glass under a round canopy, turning while you're at it | always passable while near | |
| `plain` | one painted leaf with a light in it | F | Voltage, the Shed |
| `grille` | a steel cage that is the door | F | the Cherry Pit |

**A new kind** is a row in `DOOR_KINDS` (`leaves`, `glass`, `auto`, `move`) and, if its `move` is new, a function in
`street-doors.js` beside `slidingPair`, `hingedGlass`, `paintedLeaf` and `revolving`. Draw every quad through `Q`,
which projects it onto the leaves' plane, with a `layer` for what stands in front of what. The gate draws every kind
shut, half and fully open, day and night, with and without the room behind it.

## Not built

- ROOM's side of the door is still the plan's: a `single` or `revolving` street door is drawn inside as the plan's
  hinged pair or sliding pair.
- The Solenne's 2x2 model draws its doors 1.4 m high, under the 1.7 m a doorway needs, so its door is fitted to the
  room (`fit: 'room'`). It's the one door `street-doors.mjs` lets through on `room` (`ROOM_FIT_OK`); every other
  Stage door fails the gate on it.
- The open fronts (the truck yards, the Threshold and Outskirts hangars, the Reach hangar and the Long Stay pound) have
  no street door: there's no wall to hang one in. The Echelon has none either; you board it by swimming to the stern
  or by helicopter, and boarding from land is still to come.
- From a vehicle the model's own still door is what you see; the moving door is drawn only on foot.
