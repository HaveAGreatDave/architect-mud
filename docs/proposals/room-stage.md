# The Room Stage: one first-person room for every 3-D interior

> **Status: steps 1, 2, 4 and 5 built, with en-suites, balconies, live television, the real view out of the window and weather, sea, air traffic and sound past the glass; steps 3 and 6 are design.** It's the shared layer under the
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
   with nothing about baseball in it: WASD with `boothStep`'s slide, Q and E to turn, F to sit, use or get up,
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

## What's shared, and what stays separate

Every 3-D room is built from the same parts: `roomLayout` and `room-walk.js` for where you can go, `room-kit.js` for the shapes, `gl/house-style.js` and `gl/ink.js` for the look, `programs.js` for the shaders, `seat-keys.js` for the keyboard, and `coverWithVeil` in `glass-veil.js` for the GLASS loading screen. A flat, its en-suite and its balcony are one room on `gl/room.js`. The two below keep their own renderer for the reasons given.

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
| Room spec | `roomSpecOf` in `client/shared/room-layout.js`: a flat with no `flags.room` is 8 × 10 × 2.7 m, the window in the front wall and the door at the back by the right-hand corner. The suite's `room` is the same spec with `unit: 'ft'` |
| Pieces | `plugins/roomstage` sends each furniture row as `{ arche, form, dims, spot, wear, seed }`. `archetypeOf`, `formOf` and `dimsOf` read flags and weight only; the suite's chairs, bar, buffet, smokes, stools and sofa are fitted pieces in `boothLayout`, carrying their own seats and boxes |
| Layout | `roomLayout(spec, pieces)`, `roomFree`, `roomStep`, `roomSeatNear`, `placeSpot` in `client/shared/room-layout.js`. `boothLayout` is the suite's spec and fitted pieces run through it, and `scripts/shapes/room-stage.mjs` checks the result against the layout it had before (`booth-layout.fixture.json`) |
| Walker | `client/game/js/panels/room-walk.js`, used by the suite (`stands.js`) and by a flat (`room-stage.js`); it claims the keyboard through `seat-keys.js` |
| Mesh | `gl/room-kit.js` holds the shapes (box, rounded block, turned piece, drop) that both `gl/booth-mesh.js` and `gl/room-mesh.js` build from. The suite's mesh came out of the move byte for byte |
| Fittings | `gl/room-fittings.js` holds the forms a flat is fitted with: wardrobes and wall cabinets, shelves and lockers, kitchen runs and basins, pans, showers and baths, a set's deck, tables and what stands on a worktop. `client/shared/room-layout.js` says which form a row is (`rowDrawn`, `rowLook`, `layRows`) |
| Renderer | The suite stays in the ballpark. A flat is `gl/room.js`: occlusion baked into the vertex colours, up to four lamps and three panes lighting it per pixel with a highlight by material, ACES, and the ink and toon bands when the comic look is on |
| En-suite | The zone behind a flat's `in` exit is drawn behind the back wall on the same Stage (`withAnnex`, `annexFrame`, `buildAnnex`): a second rectangle to walk in, joined by the strip through its door. Crossing the door sends `in` or `out` |
| The outlook | `panels/room-outlook.js`: see below |
| People | `gl/room-people.js` poses everyone else as the close-up figure ([hd-figure.md](hd-figure.md)) in the street's `idle` or `sit` clip, or laid down for `lying`, dressed by `actorOutfit` off their id; `gl/figure-hd.js` draws them in the comic manner |

One thing differs from the plan above: the hands (`stands-hands.js`) aren't opened in a flat yet, because nothing in a flat hands you a drink the way the suite's bar does.

### The outlook

The window shows the real city, live. `room_outlook` sends the freelook window round the building, and `panels/room-outlook.js` runs GLASS on a canvas under the room's, at the flat's tile, at its storey's share of the building's height, with the player's own camera. The room is drawn over it with its panes left transparent (`see` in `gl/room.js`), the way a cabin is drawn over the world as a viewmodel, so the sea, beacons, searchlights, traffic and weather move because GLASS is painting them. An earlier version took four still shots and drew effects over them; nothing that GLASS animated moved, so it went.

- **Two cameras, one eye.** GLASS's lateral and vertical scales differ (`viewLatFocal`, `viewFocal`), so `tick` returns its projection scales and `roomMatrices` uses them (`lens`). The room's yaw, pitch (radians) and field of view go to `freeCam`.
- **The eye never leaves its own tile.** Only that tile's building is hidden (`self`), and a tile is 17.9 m, so the walk is scaled to fit the tile. Moved by true metres, the eye walked out of the back of a big flat into the building next door.
- **The frame is the world and nothing else** (`view.still`): no canopy sheen, lens flare, vignette, god rays, heat shimmer, or the aurora, which is pinned to the frame.
- **No glass in view, no paint.** `lookOut` in room-stage.js returns null facing a wall or in the en-suite. It starts 0.35 rad before a pane reaches the screen's edge, so the paint has landed by the time the pane shows.
- **The canvas is bigger than the room.** `OVER_X` and `OVER_Y` in `room-outlook.js` and `.rs-city` in `room-stage.css` have to agree: 150% wide and 120% tall, because a turn is what outruns a paint.
- **It paints on its own thread.** `room-outlook-worker.js` paints on its own canvas and posts each paint back as a bitmap, which `tick` shows in the same task as the slide. It gives `windshield.js` a small stand-in for `document`. `tick` sends the newest camera whenever the worker is free, so a paint never holds up the room: 125 ms or more on the main thread, against 0.2 ms a frame now. A turn can put the city a frame or two behind the room. Anything GLASS reads from the real page (`world-feed.js` events such as fireworks, the reduced-motion setting) is blank in the worker and has to arrive by message. `room-view.js` builds the frame for both paths. Without a worker the paint runs on the main thread with a budget: a steady view gets about half the time, a moving one every frame.
- **What's moving is fed in.** `actors` and real contacts come from the server (`room_outlook`, `room_sky`), and the timetable (`airTraffic`) goes in as contacts, so aircraft are GLASS's own models.
- **The tower isn't drawn.** `eyeBase` in `room-view.js` takes the building off the centre tile of the map GLASS paints. `self` alone doesn't hide it: a cell with a `bt` is drawn on its own tile so a roof can be landed on. Its height comes from `modelTopZAt`, read first from the map as sent.
- **A room is never in the cloud.** Towers are drawn far taller than the deck's feet allow: a penthouse's eye is at z 5.3 and a rainy deck's base at 4.7. With `still`, `DECK_FLOOR` in `windshield.js` holds the deck just above the eye, or the whole view goes pale in any cloud. It only moves the deck for a flat high enough to reach it.
- **A phone keeps the painted street**, and so does a room with no tile on the map.
- **The loading screen covers it.** The veil holds until GLASS has painted.

### What belongs to the room

`panels/room-window.js` turns `room_sky` and the clock into each frame's numbers: how much rain, how wet the glass, how much day gets through the cloud, and a lightning flash in the room. Its strikes are on the clock (`boltIn`) and aren't GLASS's own bolts, so a flash and a bolt seen out of the window don't line up yet.

- **The panes get wet** (`gl/room-sky.js`). A pane's uv is metres on the glass from 100, which is how `gl/room.js` tells it from a cabinet's. Not from the balcony, looking in.
- **The only sound is the weather.** Rain on the glass, wind on the building and thunder, set by `windowMix` (`client/shared/room-sfx.js`) from where you stand. It sits well under what's going on in the room. A city bed, the sea, aircraft, horns and sirens were tried and taken out. `scripts/audio/room-sound-smoke.mjs` holds the cues to the critic.
- **The lights dim.** The bar's slider, or `-` and `=`, sets `lampLevel`, this viewer's, in `localStorage`. It scales the lamps' light and faces (`LAMP`) with no rebuild; only crossing off rebuilds. A fire (`lamp.fire`) isn't on the switch.
- **A fire's control is the dial on the fire.** `fireDial` (gl/room-fittings.js) draws it and puts its place on `mesh.dials`; a click within reach opens the `.rs-firehud` panel beside it, and `,` and `.` still turn it. Nothing for the fire goes in the bar. The flame, the liner's glow and the coals are sheets of `FIRE` that `fireAt` (gl/room-sky.js) draws in flat colours inside an ink line.
- **`gl/room-light.js` takes six lamps and an en-suite's has to be the last.** `buildRoom` keeps the fire and the en-suite's and drops a ceiling light if it has to.

### The studio plan

Flats have no separate bedroom, so the plan does what walls would (`studioPlan` in `client/shared/room-layout.js`, carried on the spec as `plan`). You come in at the back right, into a clear lobby. Ahead, the kitchen runs down the right-hand wall behind an L of counter: a long side facing the lounge with a breakfast overhang, and a return at the front end back to the wall, so the way in is from the lobby. The bed takes the back left, by the en-suite. The lounge has the front of the room and the windows.

| Part of the room | What goes there |
|---|---|
| The kitchen's wall | `cold`, `hob`, a kitchen `sink`, a `counter`, from the lobby end toward the window, with a `cabinet` hung over them. `drawKitchen` fills every gap they leave with units and a worktop, so a flat with one hot plate still has a fitted kitchen |
| The counter | What stands on a worktop (`top`, a `microwave`) when the sink's run is full or absent, as `{ on: 'counter', x }`. A `stool` goes on the lounge's side of it |
| The back left | `bed`, `wardrobe`, tall `store` |
| The lounge | `screen` and `deck`, seats facing the screen, a `table` in front of them, and what's left against its walls |

Nothing stands in the lobby, on the walk from it along the counter, or across the back of the room to the en-suite door, and only the kitchen's pieces stand in the kitchen. The counter, its return and the wall units are solid to a walker but aren't furniture rows: they're part of the room, like its walls. A room under 6.5 × 7.5 m has no plan and is furnished wall by wall. Each part of the room has its own light. `scripts/shapes/room-stage.mjs` walks every flat in `content/` from its door and fails if a seat, a thing you can use, the lounge or the en-suite can't be reached, or if a piece is in the wrong part of the room.

### The balcony

A studio above the ground floor has a balcony past its front wall (`spec.balcony`, `drawBalcony`): a door out of the lounge, a deck and a rail. A tower flat's runs the width of the room behind a glass balustrade, and a plain one is a concrete slab on a steel rail beside its window. It's part of the walk, in the room's own frame at negative `v`, and no zone change: stepping out sends nothing. `uOutZ` in `gl/room-light.js` turns the lamps off out there and lights it by the day. The face of the building is drawn round it, stopping at a corner where the flat has glass round the side. `flags.room.balcony: false` takes it away, and a zone whose `marker` or `flags.room.storey` says 1 has none. `flags.room.balcony: { wrap: 'all' }` runs the deck right round the building, as the Solenne Penthouse's does. The building is then a closed block, with a face down each side and across the back at `spec.balcony.wrap`, so an en-suite and the corner beside it are inside it. That deck is at every `u` and `v`, so ask `onBalcony` whether a spot is outside, never `v < 0`; pass `u` to `inAnnex` for anything that can walk, or the back deck counts as the bathroom; and `uOutRing` does for it what `uOutZ` does for the front.

### Television on the wall

A set in a flat shows what's on. `panels/room-tv.js` is a third surface for `createTvView`, after the CRT popup and the tablet, so every show, ticker, scorebug and Gameday comes through the one renderer. Its page is laid out off the side of the window, and `panels/page-paint.js` paints it to a canvas up to thirty times a second, and not while the set's behind you, which `gl/room.js` draws on that set's stretch of the screen batch (`K.screens`, `first` and `count`). It's in the picture, so the room's depth hides it and a person can walk in front of it. `setWallTv` makes it the surface tv.js's panel calls go to while the room's open, so `watch` and `tune` arrive on the wall and the server needs no change. F or a click on the set starts it and stops it, and the bar's dial or `[` and `]` change the channel by sending `tune`.

page-paint.js covers what a broadcast uses; its header lists what it leaves out. Other people in the flat see a dark set until they watch it themselves.

### The action card

Facing a piece within reach brings up a card at the bottom of the picture: its name and everything it offers. F is the first line, 2 to 9 the rest, and a tap or click on a line does the same. A click on a piece holds the card on that piece, from across the room, until you walk off or press Esc; while you're on a piece its first line is Get up. Every line is a verb. `furnitureActs` (server/engine/furnitureActions.js) sends the list on each piece as `acts`, plugins add what no tag can gate through `furniture.acts` (a shower, a toilet, a stove), and `client/shared/room-acts.js` orders and labels it. A verb that hides itself from strangers stays off the card, because pieces go to everybody in the room. The log is covered, so what the server answers in the 2.5 seconds after a line shows on the card (`roomSays`). A piece on the other side of the en-suite door isn't offered until you're through it, because the verb runs in the zone you're in.

### Talking to people

Facing an NPC within eight feet brings up the card with their name and Talk, and they win over the furniture around them. A click on them holds the card from across the room, as it does for a piece. Talk is the verb `talk <name>`, so it reaches the same conversation or shop as typing it, and the dialogue panel comes up over the room with the keys while it's open. Somebody on the far side of the en-suite's door can't be talked to, because the verb runs in your zone.

### People at home

With the Stage open, a resident (`home_zone` is this flat, awake, off shift, not in a fight) gets up every minute or three and walks to a seat, something they can use, the window or a spot on the floor (`plugins/roomstage/npc-life.js`). `roomPath` finds the way: a breadth-first search over a 20 cm grid on `roomFree`, pulled tight into straight legs. The route goes out once in `room_people` and the client walks it, so a walk is two messages. It's RAM only, it runs only in a room with a viewer, and it never changes the NPC's posture, so the room text doesn't change. When somebody with the Stage open has a set on (`tv.watch`), residents go and sit in the free seat that faces it best, and stay until it goes off; with no free seat they carry on. A scene in `home-life.js` sends them to the cooker (`npc.home.scene`), and its trip to the en-suite is walked through the door after the engine's move.

What NPCs say comes up in a bubble at the bottom of the screen, in the game as well as here, spoken by ORACLE on the `npc` channel with the voice their name rolls (`panels/npc-bubbles.js`). It reads `.speech-line` off the same messages the log prints. With the Stage up, the room's emotes and ambience come up as unvoiced bubbles too, since the log is covered. The log rung gets neither.

### Room sizes and finishes

`flags.room` takes `{ w, d, h }`, `glass` (the walls that are floor-to-ceiling glass: `front`, `left`, `right`), `finish` (`plain`, `fine`), `ensuite` (`{ w, d, finish }`), `studio` (`false` for no studio plan), `storey`, `storeys` and `face`. `tone` (`{ wall, trim, ceiling, accent }`, each a hex) paints a room its own colours, and `accent` runs a metal round it at the skirting, the door heads and the ceiling, lines its doorways and is the bezel of its set: the Solenne lobby is dark with gold. `sign` (`{ text, sub, wall, at, y, size }`) is a name on a wall, painted as one texture (`paintSign` in gl/room-mesh.js), never as faces, so it neither flickers nor looks pieced together; `sub` is a small second line. A wall piece's `flags.spot.y` hangs it with its middle that high, as the lobby set over the reception desk is. A flat without it is 8 × 10 × 2.7 with one sash window. `fine` swaps the boards for oak, the pendant for downlights, the sash for black-framed glass and the tired fabrics for quiet ones, and gives an en-suite stone walls in place of tile. The Solenne Residences are authored in `scripts/content/room-looks.mjs`: 30-B is 12 × 13 × 3 with glass on two sides.

The Room Lab (`/room-lab.html` in the Modelshop) opens any of these off the content files with no server.

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
