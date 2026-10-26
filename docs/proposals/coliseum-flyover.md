# Flying over the Coliseum

**Status: design, 2026-10-25. Nothing here is built.** A pilot who flies over the Charles B.
Hughson Coliseum on a game night, with the roof open, sees the game being played: the nine in
the field, a batter, runners on the bags, a full house. Later the park sees the pilot back: the
crowd and the booth notice a low pass, and the plane shows on TV when it crosses the frame.
The pilot side comes first because most of it is already drawn.

Read with [hughson-coliseum.md](hughson-coliseum.md) (the park, the roof and the lights),
[systems-broadcast.md](../systems-broadcast.md#sports--two-codes-one-pipeline) (the Gameday
payloads), [deadball-glass2.md](deadball-glass2.md) (the Grandstand),
[coliseum-seats.md](coliseum-seats.md) (the park clock, in design),
[systems-flight.md](../systems-flight.md) (the contacts relay) and
[architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime).

## The short version

- **The game is already one truth.** Deadball games are seeded and simulated on the server, one
  graph per slot, and every TV seeks the same graph off the same clock. A pilot reads that graph
  too, so the field below and the game on TV agree.
- **The bowl is already open and lit for the pilot.** `venue.roof` and `venue.lit` reach the
  windshield and GLASS 2 bakes the park by game night and roof. What's missing is the people on
  the field.
- **The server tells a nearby pilot what's on the field**, in a small `venue_field` push: the
  half, the outs, who's on base, which way the batter stands. It's sent on entering range and on
  each change, never per sync, and it's worked out from RAM.
- **The windshield draws the field as street figures.** Fielders stand where
  [diamond/play.js](../../client/game/js/panels/diamond/play.js) puts them (the same spots the
  server judges plays on), drawn through the actor layer, so its LOD does the work at altitude.
- **It should cost well under 0.1 ms a frame** if the figures stay out of the coliseum arm and
  the crowd isn't geometry. Break either rule and it's up to about 1 ms
  ([Frame cost](#frame-cost)).
- **Then the park looks back.** A low pass is an event the booth and the crowd can answer
  (Phase 2), and aircraft near the park reach the Grandstand as lights in its sky (Phase 3).
- **Nothing names the Coliseum.** The park is `sports_pools.venue.site` and its tiles' flags.
  Flight and broadcast talk through hooks, as they do for the roof.

## What exists

- **The game on the server.** `scriptsPlayingNow` in
  [plugins/broadcast/index.js](../../plugins/broadcast/index.js) knows which sports scripts are
  being played now, whether or not a channel shows them; it's what lights the towers
  (`refreshVenueLights`). `getSportsGraph(script, slot, override)` returns the slot's graph, built
  once and cached (`_sportsGraphCache`). `_seekGraph` walks a graph forward by elapsed time to put
  a late tuner on the line that's on now.
- **⚠ A graph only runs while a TV is tuned.** The channel tick drives a channel's graph for tuned
  zones (and for an observed studio). With nobody watching, no line airs and no Gameday payload
  exists. The pilot can't wait on an aired line; it needs a seek of its own.
- **What a payload says.** An at-bat carries the batter and pitcher, `bats`, outs, the bases
  before and after, `moves` (every man's fate on the play), `play` (the ball in play, decided by
  `synthPlay`) and `hold`. A half-inning break carries `phase: 'half'`. `gamedayOnAir` adds the
  weather, the clock and the roof as a line airs.
- **The roof and the lights in GLASS.** The derive in
  [plugins/flight/state.js](../../plugins/flight/state.js) puts `vl` and `vr` on the park's cells;
  `venue_lit` and `venue_roof` pushes amend them, kept by
  [world-feed.js](../../client/game/js/panels/world-feed.js) (`venueState`, `venueEpoch`). In
  [gl/world.js](../../client/game/js/panels/gl/world.js), `venueKey` puts the game night and the
  roof in the mesh key, so a lit park and an open roof are already baked. The arm is
  [glass/models/coliseum.js](../../client/game/js/panels/glass/models/coliseum.js); its stands are
  empty mesh.
- **The contacts relay.** `contactsNear` and `relayContacts` in
  [plugins/flight/combat.js](../../plugins/flight/combat.js) push nearby craft to each continuous
  pilot on every flightsync, and the `vehicle.contacts` gather hook lets other vehicles add
  themselves. Only the pilot seat of a continuous cockpit gets them.
- **Street figures.** [gl/actors.js](../../client/game/js/panels/gl/actors.js) draws
  `actor` records from `FAUNA_SINK` with two bodies and a billboard by on-screen size
  (`RENDER_TUNE.actorMeshPx`, `actorFarPx`). The baked clips are `walk`, `idle` and `wave`.
  There's no run.
- **The field's spots.** `fieldSpots(bats)` in diamond/play.js is where the nine stand, shaded to
  the hitter's pull side. It's pure and shared by the server's play judge and the Grandstand.

## 1. The pilot's view (Phase 1)

### What's on the field now

The broadcast plugin works out a park's state from the graph, without a channel:

- For each script in `scriptsPlayingNow` with a `venue.site.block`, take its graph from
  `getSportsGraph` and walk it to now by the elapsed time a late tuner would seek by. The walk is
  its own, read-only: it never touches a channel's blackboard, or it would advance a channel's
  graph twice.
- The answer is the last Gameday node at or before now, reduced to what the air can see:
  `{ phase, inning, half, outs, bases, bats, moves, at, hold }`. `phase` is `ab`, `half`, `pre`
  or `post`; `bases` is the three bags after the play; `moves` lets the client walk the runners
  there; `at` is when the line went on, so a pilot arriving mid-line sees the result, not the
  play again.
- It's cached per venue and recomputed when the current node's hold runs out. It's only asked
  for while some aircraft is in range of the park, so on most ticks it costs nothing.

**`fieldNow` is sync and query-free.** The graph is in memory and the walk is arithmetic.

### Getting it to the cockpit

- Flight asks a new sync gather hook, `venue.field`, with the craft's tile and a range, as it
  asks `venue.roof` in the derive. Broadcast answers it. Neither plugin imports the other, and
  flight never learns what baseball is.
- Flight keeps its own list of park blocks, built when the world loads from the tiles carrying
  `flags.venue_lights`. On each flightsync it tests the craft against that list (a Chebyshev
  distance to a few rectangles, as cheap as `contactsNear`) and asks the hook only when the craft
  crosses into range or the line changes. ⚠ **Never ask the hook on every sync** to find out
  where the parks are; that's a hook call for every aircraft on every sync. When a craft comes
  within `FIELD_RANGE` tiles of a block, its pilot gets a `venue_field` push. The pilot gets another when the answer
  changes, and `{ field: null }` on leaving range or when the game ends. A pilot circling for ten
  minutes gets one push per line, not one per sync.
- It goes to the people `pushContacts` reaches: the pilot of a continuous craft, not a text pilot.
  Passengers are a question below.
- The hook gets a row in the hook reference in [server.md](../server.md), or `docs:hooks` fails.

### What the windshield draws

- **Only over an open, lit park.** When `venueState` says the roof is shut, nothing changes: the
  shells hide the field, as now. While the roof rolls, draw the field; the shells cover what they
  cover.
- **The fielders** at `fieldSpots(bats)` in the fielding side's kit; the pitcher on the rubber;
  the catcher, the batter on his side of the plate and the plate umpire; a runner on each
  occupied bag. On `phase: 'half'` the field is empty. On `pre` and `post` it's empty too, with
  the lights on.
- **The play, plainly.** At the start of a line the runners walk from their old bags to their new
  ones along `moves` (the `walk` clip, played fast; nobody can tell from 800 ft), and a runner
  who scores leaves the field. No ball: at flying height a baseball is under a pixel.
- **As actor records**, emitted per frame into `FAUNA_SINK` by a pass of their own, the way
  street people and birds are, so the actors' LOD decides mesh or far body by size. ⚠ **Never
  from the coliseum arm and never in the venue's mesh.** The arm is kept and replayed while
  nothing about it changes, and the mesh is cached by `venueKey`; anything that moves between
  pushes has to stay out of both, as the roof's shells do ([Frame cost](#frame-cost)).
- **The kits** are the clubs' two colours, from the Grandstand's
  [diamond/kits.js](../../client/game/js/panels/diamond/kits.js), not invented in the arm. If
  that module drags in the Grandstand, the colours move to a shared one.
- **The stands are full on a game night.** The game night is already in `venueKey`, so the
  stands' existing faces can take a crowd on lit nights at no cost per frame: a speckle of mixed
  colours in their colour or a texture. ⚠ **Not geometry.** No quads per person, in decals or
  in the mesh ([Frame cost](#frame-cost)).
- **GLASS 2 only.** The 2-D painter gets nothing new.

### Text pilots and the text rungs

The first time a craft comes within range of an open, lit park on a pass, the pilot gets one
line in the flight feed, from the same state: the inning, the outs, who's on. Something like
"Below, the Coliseum's open and lit. Two out in the seventh, a man on second." It's written in
the house voice when it's built, and it's what a text pilot gets instead of the picture.

### Gates

- **`shapes:smoke`** runs the coliseum arm with a field state, open and shut, lit and dark, and
  checks the figures appear only when it's open and lit, and never in the mesh capture.
- **The park stays kept.** A flight past the open park with a game on, under `armKeepWhy`, finds
  the coliseum arm replayed, never live for the field. The stands' crowd adds no vertices to the
  park's mesh between a dark night and a game night.
- **A `fieldNow` gate** walks a seeded game at fixed times and checks each answer's bags and
  outs match the payload the Grandstand would have aired at that time. It needs no server.
- **Flight regress** checks a craft in range gets one `venue_field`, a craft out of range gets
  none, a circling craft doesn't get one per sync, and the path makes no query (patch the pool).

## 2. The park notices (Phase 2)

- **A low pass** is a craft over the park's block below a height above ground, with the roof
  open. Flight sees it on a sync and fires a `venue.overflight` event with the craft's type,
  height and speed, once per pass.
- **The booth** answers on its next line from a new pool in
  [baseball.bsm](../../data/scripts/baseball.bsm), so it's content and the voice is the booth's.
  The line should name what it saw (a gyro, a cargo plane) when it can, and never the pilot.
- **The crowd** gets a murmur and a turn of heads in the park's sound
  ([systems-deadball-sound.md](../systems-deadball-sound.md)), and players in the Stands and the
  Bleachers get a room line.
- **Whether it's a crime** to buzz a full stadium is a question below.

## 3. The plane on TV (Phase 3)

- **Who gets it.** The zones tuned to the channel carrying the park's game, which the channel tick
  already knows (`activeChannels`); the seats when [coliseum-seats.md](coliseum-seats.md) is
  built.
- **What they get.** Once a second, while a game is tuned, broadcast asks flight through a sync
  gather hook for craft within range of the site: `{ id, type, x, y, alt, hdg, spd, t }`. It
  pushes a `gameday_air` list to the viewers when the set or a craft's heading or speed changes
  past a threshold, and the client extrapolates between. A crossing is seconds long; one push in
  and one push out is the usual case.
- **What they see.** At night most of an aircraft is its lights: red and green at the wingtips,
  a strobe, a landing light. The Grandstand's sky draws those first, which is cheap and right
  for a park that airs from 18:00. A silhouette from the windshield's aircraft models is a
  follow-up, and whether
  [gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js) can share those meshes hasn't been
  checked.
- **The director** can take a sky shot in the dead time
  ([diamond/between.js](../../client/game/js/panels/diamond/between.js), `shotsBetween`) when a
  craft passes low over the block. Never during a pitch. On a wide shot the plane is just there if
  it's in the frame.
- **The sound.** The park's mixer already hears the live world each frame, so an engine passing
  over is a source it can hear. Under a shut roof you hear it and don't see it.

## Frame cost

Nothing here is measured, because nothing is built. These are estimates against what
[glass-headroom.md](glass-headroom.md) measured: from the Halcyon cockpit a frame is about 11 ms,
about 6 ms of it GPU, 2.8 ms building models (`world:arms`) and 4.8 ms GL work.

| What | Done wrong | Done right |
|---|---|---|
| The field's figures emitted by the coliseum arm | the park's arm runs live every frame: 0.34 to 0.87 ms a frame (the ballpark row in glass-headroom's arms table, after and before `flatEarly`) | emitted by their own pass; the arm stays kept and replays |
| The crowd | tens of thousands of quads in the park's mesh, drawn every frame it's in view and again by the shadow pass, a few percent of the GPU on a desktop and more on a phone, and a bigger re-bake hitch when the lights come on or the roof moves | a colour or texture on the stand faces that are already there: no vertices |
| The figures themselves | | about 14 records, 420 floats through `upload()`, about 5,000 vertices of far body in one instanced draw: well under 0.1 ms a frame |
| The range check | a hook call per aircraft per sync | a test against flight's own list of park blocks; server CPU, not frame time |

**The rules that follow:**

- **Figures never go through the coliseum arm.** A moving part counted against the kept set takes
  the whole building live, as a windsock once did for every flagged building (`armLiveSide`).
- **The crowd is never geometry.** From the air a crowd is a texture: dots in mixed colours.
- **No figures when the park is small on screen.** Below a few pixels across, draw none. When the
  diamond is 20 px nobody can see a fielder.
- **A dot, not a person, at far range.** Under the far body's size, a dot in the team's colour on
  each position reads as a player. Never the canvas billboard: what it costs per figure is
  unmeasured, and it could cost more than the GL body.
- **Movement only when there's something to move.** Fielders stand on `idle`, the slow clip with
  few frames. Runners walk only for the seconds after a play, then stand.
- **No shadows from the figures at altitude.** They're under a pixel.
- **Phones get dots or nothing.** Phones already go without the materials pass, and this goes
  with it.

**What sells it is mostly free already.** A lit green field inside dark stands is in the mesh
today. The figures, the crowd's colour and the runners moving are the rest. One cheap extra: a
few camera-flash glints in the stands on a big play, through the light or sprite layer, for the
play only.

**Measuring it once it's built:** `perf:move --gl` with the arms profiler
(`setWindshieldProfiler(true, { arms: true })`), flown past the park with the roof open and shut,
with a game on and off, and `armKeepWhy` on to confirm the park still replays. A hidden Browser
pane can't be timed, so the numbers come headless or from a visible pane.

## Read tiers and egress

- Nothing here reads the database. The graph, the clock, the roof and every aircraft are in
  memory.
- `fieldNow` runs only while a craft is in range of a park, once per line per venue.
- ⚠ **Assembly.** If no TV has built the slot's graph, the first `fieldNow` builds it: a whole
  game's sim, once per slot. That's a CPU cost, not a round trip, and the towers already need
  `scriptsPlayingNow`. Measure it before Phase 1 ships.
- The pushes are small and rare: one per line to a pilot in range, and one per crossing to a
  tuned TV.

## Engine and content

- The park is content: `sports_pools.venue.site` names the block, the tiles carry
  `flags.venue_roof` and `flags.venue_lights`. Nothing in flight, the windshield or the arm names
  the Coliseum or its coordinates. A second park with a site gets all of this.
- The hooks (`venue.field`, the Phase 3 airspace hook) keep flight and broadcast apart.
- The booth's flyover lines and the text pilot's line are content in the scripts' pools.

## Phases

| Phase | What | Needs |
|---|---|---|
| 1a | `fieldNow`, the `venue.field` hook, the `venue_field` push, the gates | nothing |
| 1b | fielders, batter and runners in the windshield; the full stands on a game night | 1a |
| 1c | the text pilot's line | 1a |
| 2 | the low pass: the event, the booth's pool, the crowd, the room line | 1a |
| 3a | `gameday_air` to tuned viewers; lights in the Grandstand's sky | 2's pass detection |
| 3b | the director's sky shot; the engine in the park's mix | 3a |
| 3c | a silhouette; the seats get it | 3a, coliseum-seats |

## Risks

- **The TV and the air disagree inside a line.** The Grandstand leaves pitches out and cuts away
  when the bags change; the air shows the line's result at the line's start. They agree at every
  line boundary, which is all a pilot can check from up there.
- **Payload changes upstream.** Commit `feee5ae1a` (not on `main`) adds `then` plays and
  `uncalled` payloads; `fieldNow` has to read them when it lands, or a pilot sees bags that skip a
  play. The park clock in [coliseum-seats.md](coliseum-seats.md) would time every pitch, and
  `fieldNow` should read it in place of line time if it ships.
- **The seek's cost.** `_seekGraph` steps node by node from the start; late in a game that's a
  few thousand steps. Once per line per venue is fine. If it isn't, remember the last position
  and walk from there.
- **No run clip.** Runners walk fast. If that reads wrong on a low pass, the actors need a run.

## Questions for David

- Do passengers with a window see the field, or only the pilot?
- Is a low pass over a full stadium a crime, and how low is low?
- Should other vehicles get it too: the Echelon's helm, the Podracer, a gyro hovering?
- Should the booth ever name the aircraft by its tail or its owner, or only by what it is?
