# The Room Stage: one first-person room for every 3-D interior

> **Status: design.** Nothing here is built. It's the shared layer under the
> [Home Stage](home-stage.md) and the Platinum Box suite; where it disagrees with
> [plugins/stands/README.md](../../plugins/stands/README.md) about what ships today, the README wins.

## Why

The Platinum Box suite is the one room you can walk round in first person, and its parts grew
inside it:

| Part | Where it lives now | Generic already? |
|---|---|---|
| The room's shape | `flags.stands.sections[].room` on `zone_hughson_platinum_box`: `{ at, face, floor, w, d, h }` | Yes: content, not code |
| Layout and collision | `boothLayout` in `gl/booth-mesh.js`: seats with eyes, stations, `solid`, `climb`, `world()`/`local()` | The shape is; the furniture in it is hard-coded |
| Walking | `walkSuite` in `panels/stands.js`: WASD, E to sit or use, click to pick, standing up into free floor | No: private to stands |
| Keyboard | its own `document` listeners | No: every other seat uses `seat-keys.js` |
| Hands | `panels/stands-hands.js`: smoke, drink, eat, mix, each ending in the ordinary verb | Yes: it draws on its own canvas and knows nothing about the suite |
| Drawing | `setRoom` inside the ballpark renderer (`gl/ballpark.js`), baked-emissive faces | No: only exists inside a ballpark |

The Kitchen Stage is a third 3-D interior with its own renderer (`gl/kitchen.js`) and fixed camera
shots instead of walking. The Home Stage would be a fourth. Built separately, each would carry its
own walker, its own idea of a seat and its own keyboard handling, which is how the cab, the cockpit
and the wheelhouse ended up with three copies of the same keyboard code before `seat-keys.js`.

## The layers

One room, described once, drawn by whichever renderer hosts it.

1. **Room spec (content).** `{ w, d, h, floor, face, window, door }` on the zone. The suite's
   `room` is already this. Apartments get it as `flags.room`, which is phase 0 of the Home Stage.
   A room without a spec has no Stage; the text is unchanged.
2. **Pieces (server).** The furniture rows in the room, each with an archetype, a spot and the verbs
   it answers to. A flat sends its placed and fitted rows. The suite's bar, buffet and smokes are furniture rows already
   (`stands fetch` finds them by alias); its chairs and sofa would become rows too, so the layout
   stops hard-coding them.
3. **Layout (pure, shared).** `roomLayout(spec, pieces)` returns what `boothLayout` returns now:
   seats with their eyes and facings, stations with a reach, `solid` and `climb` boxes, `world()`
   and `local()`. Each archetype contributes its own seats and boxes, so a sofa gives two seats and
   a `lie`, a fridge gives a station, and a stool pulled up to a desk gives one seat facing it.
   `boothLayout` becomes the suite's spec run through it.
4. **Walker (client, shared).** `walkSuite` lifted out of `stands.js` into `panels/room-walk.js`
   with nothing about baseball in it: WASD with `boothStep`'s slide, E to sit, use or get up,
   a click to pick a seat or station, standing up into the nearest free floor. It claims the
   keyboard through `seat-keys.js` like every other seat, so the suite gains the readout and the
   capture-phase fix it lacks today.
5. **Hands (client, shared).** `stands-hands.js` unchanged, opened from any room. A drink from your
   own fridge goes through the same ritual as one from the Platinum Box bar and ends in the same
   `drink`.
6. **Renderer (host).** The layout is drawn by whoever owns the picture. The ballpark keeps drawing
   the suite inside the park, because the park through the glass is the point. Rooms with no host
   (flats, bars, Holding) get a small standalone room renderer built from the same batch, `MAT` and
   ink outline (`gl/ink.js`) that GLASS 2 already uses. The window shows the street through the
   existing windshield paint rather than a second scene.

## What stays separate

- **The Kitchen Stage's shots.** Cooking is framed at a counter, not walked. It shares the keyboard
  module and the ink, and could use the walker for "step back from the counter" later, but its
  camera stays its own.
- **The ballpark and rink renderers.** Hosting a room doesn't make them generic; they just accept a
  layout.
- **Server rules.** Nothing in these layers decides anything. Every action is still a typed verb,
  and the text and log rungs are unaffected ([systems-display-mode.md](../systems-display-mode.md)).

## Order of work

| Step | What changes | How it's checked |
|---|---|---|
| 1 | Lift `walkSuite` into `room-walk.js`; the suite calls it, and claims the keyboard via `seat-keys.js` | The suite walks, sits and fetches exactly as before; `client:smoke` |
| 2 | `roomLayout(spec, pieces)`; `boothLayout` becomes the suite's spec plus its pieces | The suite's seats, stations and collision boxes come out identical (a gate comparing the two) |
| 3 | The suite's fixed furniture read from its zone's furniture rows | Moving a buffet row moves the buffet |
| 4 | The standalone room renderer | A shapes-style gate builds every archetype in a stub room |
| 5 | Home Stage phases 1-3 on top | [home-stage.md](home-stage.md) |
| 6 | Bars, Holding and storefronts as more rooms with a spec | Each is content plus a spec, no new walker |

Steps 1 and 2 change nothing a player sees. They're worth doing before the Home Stage so the second
room is built on the first rather than beside it.

## Open questions

- **Units.** The suite works in the park's feet, the Kitchen Stage in centimetres, GLASS in tiles.
  The layout could work in metres with `world()` doing the conversion, or keep each host's unit and
  carry a scale. Metres is easier to author; feet means the suite's numbers don't move.
- **Who sends the pieces.** The suite's furniture is in content; a flat's is player rows. One
  `room_view` payload for both, or each plugin sending its own and the client merging?
- **Other people in the room.** The suite draws only you. A flat with a visitor (Home Stage phase 3)
  needs other bodies; that's the actor renderer's job, and it decides whether this layer needs
  anything more than a seat being taken.
