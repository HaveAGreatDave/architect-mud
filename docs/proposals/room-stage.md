# The Room Stage: one first-person room for every 3-D interior

> **Status: steps 1, 2, 4 and 5 built; steps 3 and 6 are design.** It's the shared layer under the
> [Home Stage](home-stage.md) and the Platinum Box suite. "As built" below says what ships; where
> it disagrees with [plugins/roomstage/README.md](../../plugins/roomstage/README.md) or
> [plugins/stands/README.md](../../plugins/stands/README.md), the README wins.

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
| 3 | The suite's fixed furniture read from its zone's furniture rows (not built: the suite's pieces are fitted pieces in `boothLayout`) | Moving a buffet row moves the buffet |
| 4 | The standalone room renderer | A shapes-style gate builds every archetype in a stub room |
| 5 | Home Stage phases 1-3 on top | [home-stage.md](home-stage.md) |
| 6 | Bars, Holding and storefronts as more rooms with a spec | Each is content plus a spec, no new walker |

Steps 1 and 2 change nothing a player sees. They're worth doing before the Home Stage so the second
room is built on the first rather than beside it.

## As built

| Layer | Where it lives |
|---|---|
| Room spec | `roomSpecOf` in `client/shared/room-layout.js`: a flat with no `flags.room` is 4 × 5 × 2.6 m, the window in the front wall and the door at the back by the right-hand corner. The suite's `room` is the same spec with `unit: 'ft'` |
| Pieces | `plugins/roomstage` sends each furniture row as `{ arche, form, dims, spot, wear, seed }`. `archetypeOf`, `formOf` and `dimsOf` read flags and weight only; the suite's chairs, bar, buffet, smokes, stools and sofa are fitted pieces in `boothLayout`, carrying their own seats and boxes |
| Layout | `roomLayout(spec, pieces)`, `roomFree`, `roomStep`, `roomSeatNear`, `placeSpot` in `client/shared/room-layout.js`. `boothLayout` is the suite's spec and fitted pieces run through it, and `scripts/shapes/room-stage.mjs` checks the result against the layout it had before (`booth-layout.fixture.json`) |
| Walker | `client/game/js/panels/room-walk.js`, used by the suite (`stands.js`) and by a flat (`room-stage.js`); it claims the keyboard through `seat-keys.js` |
| Mesh | `gl/room-kit.js` holds the shapes (box, rounded block, turned piece, drop) that both `gl/booth-mesh.js` and `gl/room-mesh.js` build from. The suite's mesh came out of the move byte for byte |
| Renderer | The suite stays in the ballpark. A flat is `gl/room.js`: occlusion baked into the vertex colours, the lamp and the window lighting it per pixel with a highlight by material, ACES, and the ink and toon bands when the comic look is on |
| People | `gl/room-people.js` draws everyone else from the street figures' body (`actor3d.js`) in its `idle` or `sit` clip, or laid down for `lying`, dressed by `actorOutfit` off their id |

Two things differ from the plan above. The window shows a painted street (`paintView` in `gl/room-mesh.js`) that follows the server's clock, not a `paintWindshield` call, so a flat doesn't need the city loaded. And the hands (`stands-hands.js`) aren't opened in a flat yet: nothing in a flat hands you a drink the way the suite's bar does.

## Decided

- **One shared payload** (Dave, 2026-11-01). Every room sends one `room_view`: its spec, its pieces
  (archetype, spot, verbs, state) and who's in it. The suite's plugin and a flat's plugin each fill it
  from their own rows, and the client builds a room one way. A change to a piece (placed, taken, a
  fridge opened, a set switched to another channel) sends that piece again, not the whole room.
- **People see each other** (Dave, 2026-11-01). Everyone in the room is in the payload with where
  they stand and what they're doing (standing, sitting on a piece, lying, holding something), and
  each client draws the others through the actor renderer. A seat somebody else is in can't be sat
  in. Position is sent when it settles, not every step, so a walk round the room is a few messages,
  not a stream; a hot path never queries for it (the read tiers in
  [architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime)).
- **Rooms use metres** on the world scale's ruler (`docs/proposals/world-scale.md`, PR #62), with the
  ballpark's feet and the kitchen's centimetres as declared frames.

## Open questions

- **What others see you holding.** The hands draw your drink and your cigarette in first person.
  Whether other people see a bottle in your hand and smoke over your head is the actor renderer's
  work, and a smaller first step is to show only posture.
- **Privacy in a flat.** A visitor sees the tenant and anyone else there. Whether the tenant can
  see who's at the door before opening it is the doors and knock plugins' business, not this layer's.
