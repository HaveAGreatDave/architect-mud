# The Building Stage: walk a whole building, out to the street

> **Status: steps 1 to 5 built (the graph, the floor plan, their gate, walking through a doorway, the next room drawn furnished, with its people, lift cars with a 3D button panel, sliding doors and a ride you feel, flats on corridors with their en-suites in the plan, room finishes, the street door out to GLASS on foot and back with the street warmed ahead, automatic glass street doors, and the view out placed in the world); stairs, portal culling and authoring are design.** It extends the [Room Stage](room-stage.md) from one
> room to every room of a building, and joins the building's front door to the street in GLASS.
> Where it disagrees with [plugins/roomstage/README.md](../../plugins/roomstage/README.md), the
> README wins.

## Why

The Room Stage draws one zone as one room. A flat and its en-suite are already one Stage: the
zone `in` reaches is drawn behind the back wall with its door open, walking through sends the
ordinary `in` or `out`, and a refusal puts you back (`annex`, `mainOf`, `room_here`). That's the
whole idea at two rooms. A building is the same thing at twenty: a lobby, a stair, landings,
corridors, flats, a shop floor and its back room, all zones joined by exits. Today each one is a
separate Stage, or text.

What players should get:

- Walk from the lobby up the stairs to your flat without a load screen.
- See into the next room through an open door, and see people moving in it.
- Walk out of the front door onto the pavement in GLASS, and back in.

What stays the same: every move is still a typed verb, the server still decides, and the text and
log rungs don't change ([systems-display-mode.md](../systems-display-mode.md)).

## The layers

### 1. The building graph (shared, pure): built

`buildingGraph` in [client/shared/building-graph.js](../../client/shared/building-graph.js). A
building is one interior map: the `maps` row whose `parent_zone_id` is the facade and whose
`entry_zone_id` is the room the front door opens into. Its rooms are the zones on that map, so
nothing reads a coordinate (interiors all sit at 0,0). Every exit out of a room is a **door** (same
map), a **front** door (to `map_world`) or a **link** (to another interior map: Batter Days into
the Codfather, the terminal's two halves; drawn shut for now). A door is `straight` (the opposite
exit comes back), `bent` (it comes back by another direction, so the two rooms can't share a
doorway), `one_way` or `lift` (one exit with several targets).

A room has a Stage when `roomSpecOf` gives it a spec (`flags.room`, or a flat). A room without one is
a shut door: walking into it sends the move and closes the Stage, as leaving does now. The **walk**
is the specced rooms reached from a specced entry through specced rooms, so a building's utility
room doesn't hold it back. A building is `ready` when its entry has a spec, `partial` when another
room does, `none` otherwise, and `stored` when its facade is on `map_set_aside`.

The gate is [scripts/content/building-stage.mjs](../../scripts/content/building-stage.mjs), in the
content group. It fails a ready building with a bent door inside its walk, or a walk with no front
door, and checks its own rules on a made-up building first. `--report` prints readiness; `<map id>`
prints one building. On 2026-11-08: 259 buildings, 940 rooms, 157 with a spec; 7 ready (Voltage
walks 2 rooms, the rest 1), 12 partial, 12 stored. The two bent doors in the city are both in the
Ascendant Spire, which isn't ready.

The server doesn't build the graph yet. It will at load and after `/world/reload`, from the world
Maps, never on a move, when step 3 needs it.

### 2. The floor plan (shared, pure): built

`buildingLayout(building, { zones, specOf })`, in the same file as the graph, puts every room of a
building's walk into one frame: roomLayout's host frame, x east, z north, y up, in metres, with the
entry room's middle at the origin. Each room comes back with the `at`, `face` and `floor` its spec
needs, so `roomLayout({ ...spec, ...room })` draws it in place, and with its `box`.

- A room faces the way the Room Stage already turns it (`bearingOf` in the roomstage plugin):
  `flags.room.face`, else away from its first compass exit. A room with neither, such as an
  en-suite, takes the facing of the room it was reached from. Only right angles; anything else is
  a `skew`.
- Rooms join through a door with `ROOM_GAP` (0.28 m) between their floors: each room draws its own
  0.14 m wall outside its floor, so the two back to back are the wall between. Each room's side of a
  door is measured on its own wall, across the gap. A door is in the middle of the
  shared wall unless `flags.room.doors[dir]` moves it: metres along the wall, measured east on a
  north or south wall and north on an east or west wall, so both rooms use the same measure and the
  room behind moves until the two openings meet.
- `up` and `down` stand a room on the ceiling of the one below, middle over middle. `in` goes
  through the back wall and `out` through the front, as the en-suite's door does. A lift is placed as
  "Lifts" below says.
- Every opening comes back in `doors`, with its place on each room's own walls as `{ wall, a, b }`
  in roomLayout's u and v, which is what the walker needs to cut it. A door into a room outside the
  walk is `shut`, the street door is `front` and a door next door is `link`.

The gate lays out every ready building and fails a `skew`, a `diagonal` door, a door offset past the
end of its wall, a `mismatch` (a room reached two ways landing in two places, so a door pair doesn't
meet) and an `overlap`. It also lays every building out again from the content read backwards, and
fails a plan that changes. `node scripts/content/building-stage.mjs <map id>` draws the plan a
metre a character.

Voltage is the test building: its main floor faces south with the street door on its west wall, and
the VIP mezzanine is north of it through one doorway, from the content as it stands. As a forecast,
with every room given a flat's spec, 246 of the 247 buildings that would be ready plan clean. The
Yards Tenement doesn't: 20 of its rooms face a diagonal, because their first compass exit is a
northeast-style one. The Room Stage turns those rooms 45 degrees today as well.

Seats, stations and collision for the whole building, tagged by zone, are the walker's job in step 3:
it runs roomLayout per room from these numbers.

### Lifts: built

A lift car (`flags.elevator`, plugins/elevator) is a room you stand in. The plan builds a tower bottom to
top: the car is placed once, where the ground floor's doors reach it, and then each stop in
`flags.elevator_floors`, lowest first, whose landing comes back by a plain `in`, stands across the car's
wall at its own height. That height is `LIFT_STOREY` (3.6 m) a floor number, and never lower than the top
of everything already placed, so a double-height penthouse can't run into the floor above. Each floor's
own doors are then walked as the ground floor's were. The landing's back wall faces the car, so its
`face` decides which side of the car its doors open on. Solenne's car is a through car, the lobby on its
front and every upper floor on its back, because each landing's other three walls are flats.

`plan.lifts[car]` lists the stops with their heights. The car's openings depend on where it's parked
(`roomOpenings(..., parked)`): that floor's doorway is open and leaves by `out`, and the rest are shut. A
car and its floor are drawn level with each other, whichever one you're in (`placeFrom`).

The server sends the car's `room_view` with `lift: { floors, at }`, the floors it really stops at with
the lobby as 1. The Stage draws them as a hologram hung off a reader on the car's right-hand wall, the
same card a door's hololock is: the floor the car is at in big figures, and a button per floor
(L, 12, 18, 30, 34, 40, 41, PH, 45 in Solenne) with the one it's at lit (`liftButtons` and `liftPanelAt`
in room-layout.js, the reader in `drawLiftPanel` in gl/room-mesh.js, the hologram in room-lift.js, styled
by room-lock.css). Clicking a button sends `floor <n>`, the elevator plugin's timed ride; F and the number
keys press them in order from the lowest. When
the car settles, the plugin emits `elevator.parked`, and the rider gets the car's `room_view` again with
its doors open on the new floor. `out` steps onto it as any doorway does.

A car with `flags.room.car` is clad as one (`drawCar` in gl/room-mesh.js): walnut, mirror-bronze, a
brass rail, a lit ceiling and a marble floor, with bronze doors drawn shut over the floors it isn't
at. Its open doorway has two leaves (`liftLeaves`) that the Stage slides on the props layer, so the
room is never rebuilt for them. Pressing a button shuts them; the car's next `room_view` (`ride`)
opens with them shut, so the new floor is built behind them, and they part a beat later. Shut, the
walker can't go through, and if no ride answers in 8 s they open again where you are.

A landing has doors of its own. `roomOpenings` marks the doorway from a landing into a car `slide` and
`lift`, the ground floor's plain door included, and the Stage draws it as two bronze leaves that start shut,
part as you walk up (slower than the street's glass) and close behind you; shut, you can't walk through.
Each sliding doorway keeps its own state (`S.slideShut[to]`), so walking up to the lift doesn't open the
street doors. Off a ride, the landing's doors are open behind you.

Solenne Residences is the first tower built this way: 22 rooms on one walk, from the Grand Lobby to the
Sky Pad. Every stop opens on a hall: the two residential floors on a walnut corridor with a flat at each end and
one off its north wall, the amenity floors on a short stone hall with the room through a door to the north
(`zone_solenne_hall_12` and so on, each at grid 0,0 on its floor, south of its room, so the grid joins them),
and the penthouse on its landing. Its utility room is a shut door. The roomstage regress rides it from the lobby
to 30 and steps out.

### The ride: built

Pressing a button (or typing `floor 30`) shuts the car's doors, and the elevator plugin sends the rider
`elevator_ride` (`{ car, from, to, ms }`) as it boards. The Stage (`S.rideStart`) counts the hologram's figure
through every floor it passes, eased so it starts and stops slowly, with an arrow for the way it's going and the
floor it's bound for lit; that's text on a page, so nothing is rebuilt per floor. The eye dips a centimetre as the car pulls away and lifts as it settles (`rideBob`, put back
after each frame, so the walker never sees it), and SIREN plays the shaft: a motor note bending up to speed, air
past the car and the rails' hiss. The car's `room_view` on arrival (`ride`) keeps you where you stood in it,
facing the way you faced; it used to put you in its doorway, facing in.

### Flats on a corridor: built

A flat's en-suite stands behind its back wall (`withAnnex`), and the plan didn't know: a landing put across that
wall had the bath, the basin and the pan standing in it, and the Solenne Penthouse's wrapped deck ran through its
lift. Now:

- A room with an en-suite is `deep` behind its back wall (`deepOf`: the wall and the en-suite's depth). A door
  through that wall puts the next room past the en-suite, and roomOpenings marks the flat's side of it `deep`.
- A door through a flat's back wall is at the flat's own front door (`offAt`: `spec.door` when the room has a
  studio plan or an en-suite), not the wall's middle, so a corridor meets the door and not the bathroom. Its
  offset on the corridor (`flags.room.doors.north` and so on) then says where the flat stands along it.
- The flat's doorway opens on a hall beside the en-suite (`hallOf` in room-layout.js, `HALL_W` wide): the room's
  floor carried through, a light, and the front door at the far end standing open. The walker has the hall as a
  rect, `openingCrossed` looks past its far wall, and `openingInside` stands you at its corridor end.
- Every room's `foot` (`footOf`) is its floor with its en-suite, hall and balcony, and `overlap` is tested on
  those, so a bath in a landing fails the gate.
- `flags.room.balcony.wrap: 'sides'` runs a deck round the front and both sides and stops at the back, where a
  penthouse's landing and lift are. The penthouse has it.

### The plan's mirror: fixed

The plan is a map: x east, z north, bearings clockwise. The Stage draws with roomLayout, whose right-hand wall
is -x when it faces +z, so the Stage's frame is the plan's in a mirror. `placeFrom` used to turn the plan into a
room's frame without the mirror, so every room next door was drawn on the wrong side (from the Solenne's
thirtieth-floor hall, 30-B, which the text puts east, was through the west wall), and the eye of the view out was
put on the wrong side of the building. Now the plan measures a room's u to its right on the map (`[cos f, -sin f]`)
and `placeFrom` turns, mirrors x and runs the facing back (`A.face - B.face`), and the text and the Stage agree.

### Finishes: built

`flags.room.decor` finishes a room past its plain walls (gl/room-decor.js; all data, nothing names a room):
`walls` (stone, limestone, walnut or bronze cladding on the solid runs, `on` to pick walls), `ceiling` (a lit
cove, coffers, or a light slot down a hall), `floor` (a stone border and a medallion let into it), `runner`,
`lights` (chandeliers, each one of the room's six lamps), `sconces`, `columns`, `plants`, `art`, `doors` (a
shut door with a plaque, for a stair the text says is locked), and `plaques` (a number beside the doorway to a
zone). `downlights: false` and `rug: false` drop the room's own. Any landing's lift doors get a bronze surround,
an indicator and a call plate. New furniture forms for a hotel: `reception`, `console` (with `look.dress`:
lilies, apples, thistle, an orchid), `plinth` and `slab`. A room on a building's walk no longer draws the plain
door every room had in its back wall; its doorways are its doors.

For a gym, a club room and a roof: `decor.mirrors` (a run of mirror on a wall), `decor.pad` (a landing circle
painted on the deck, with its lamps), `ground: 'rubber'`, and `open: true`, a roof deck with no ceiling and a
glass screen right round to the back wall, so the sky GLASS paints is over it. A phone has no live view out, so
its sky there is dark. The forms: `piano`, `telescope`, `games` (a chess table), `treadmill`, `weights`,
`pressbench`, `pool`, `lounger` and `firetrough`, all in gl/room-decor.js.

The Solenne's five amenity floors are finished this way by `scripts/content/solenne-amenities.mjs`, which writes
each room's `flags.room` and every row's `look` and `spot`: Bishop's Blend, Sweat Equity, The Aerie, the Sky
Deck and the Sky Pad. Edit the script and run it again, not the JSON.

### 3. Crossing a door: built

**Server** ([plugins/roomstage/index.js](../../plugins/roomstage/index.js)). `buildingOfRoom` builds
every ready building's graph and plan from the world Maps the first time a room is opened, and again
when the count of zones or maps changes; never on a move. A building whose plan has problems isn't
joined up, and each of its rooms stays a Stage of its own. A room on a walk carries its doorways in
`room_view` as `spec.openings` (`roomOpenings`), plus `building: { id, name }`. When you go through
a doorway into another room of the same walk, `zone.entered` moves you to that room's viewers and
sends its `room_view` with `via` (the room you came from) and its outlook, instead of `room_close`.

**Shared** ([client/shared/room-layout.js](../../client/shared/room-layout.js)).
`withDoorways(spec, openings)` puts the openings on the spec, and a doorway wins over a window: the
middle room of a chain faces away from its first exit, so its other door is in the window wall, and
a pane it would cut into goes (`windowless` when none is left). `doorwaysOf` is the open doorways
that don't run into the en-suite's door, the balcony's or each other; the mesh, the walker and the
crossing test all read it, so a doorway is cut exactly where you can walk. Each one gives the walker
a strip through the wall and 0.6 m past it. `openingCrossed` says which doorway a spot has gone
through, and `openingInside` where you stand just inside one, facing into the room.

**Client** ([room-stage.js](../../client/game/js/panels/room-stage.js),
[gl/room-mesh.js](../../client/game/js/panels/gl/room-mesh.js)). The mesh cuts each doorway, lines
it, and puts a short dim passage past it so the hole doesn't open on the street the window shows. A
doorway over the flat's own drawn door takes its place. Stepping through sends `move <dir>` once. The
next room's `room_view` reopens the Stage there, standing you inside the doorway you came through,
without the GLASS loading screen. With no answer in 1.8 s, the door didn't let you through: you're
put back inside it with "The door won't let you through." Locks, move gates, pacing, Holding and
guest rules all still apply, because nothing new moves a player.

A crossing doesn't reopen the Stage. When the next room's `room_view` is in the same building, `ui.cross` in
room-stage.js swaps the room's own state (spec, pieces, people, the rooms next door, the walker, the car's and the
street's doors, the bar's name, the set) and keeps the pane, the canvas, the GL renderer and the view out, so the
last frame of one room stays up until the first of the next and nothing compiles again. A lift ride goes the same
way. A doorway in the same wall as an en-suite's door no longer reads as going into the en-suite: only the
en-suite's own width counts, and not while a doorway is being crossed. Shut doors are still plain wall, and stairs
aren't walked.

Checked by the roomstage regress suite (a three-room building, its doorways, the walk through with
the real `north`, and a door a move gate refuses) and by check 10 in
[scripts/shapes/room-stage.mjs](../../scripts/shapes/room-stage.mjs) (every wall's doorway cut,
walked through and come back from, the window and the flat's door given way, a shut door left whole).

### 4. Drawing the next room: built

Every room one open doorway away is drawn, furnished and with whoever's in it: walls, floor, ceiling,
windows, its fitted parts and its furniture, with its own baked light, and its people as figures. It's
lit by its own lamps: the four nearest neighbours each give their two strongest, turned up to stand for
all of them, and each lights only inside its own room's box on the ground (`next` in gl/room.js), so a
room looks from the doorway as it does once you're in it. Its windows aren't lights until you are. Rooms further away aren't drawn; a doorway
out of a neighbour into one of them is the dim passage step 3 draws.

- **Payload.** `buildingView` in [client/shared/building-graph.js](../../client/shared/building-graph.js)
  is what a room's Stage gets from its building: its spec with its doorways, and `building.neighbours`,
  each neighbour's spec with its own doorways and the `at`, `face` and `floor` that `placeFrom` works
  out from the plan. The Stage draws the room you're in at the origin facing 0, so those numbers put the
  neighbour's walls in the same frame as yours. `walkPlans` is the plans for every ready building. The
  roomstage plugin and the Room Lab both call these two, so the lab can't draw a building the game
  wouldn't.
- **Mesh** ([gl/room-mesh.js](../../client/game/js/panels/gl/room-mesh.js)). The Stage builds each
  shell once when it opens, with `buildRoom` and the neighbour's own seed, so a room looks the same
  from inside and through a door. `withShells` adds their solid, glass and textured batches to the
  room's own every time the room's mesh is built (lights, a door, a turntable). It never adds a
  shell's view box, since the room's own is round them all. Its lamps go to the renderer apart, each
  frame (room-stage.js `nextLit`). A doorway into a drawn neighbour is a threshold across this room's wall (`joined`), and
  the neighbour lays the other half across its own.

- **Furniture and people.** `room_view` gives each neighbour its `pieces` and `people`, laid out as the
  plugin lays out that room when you're in it. While your Stage is open, the server sends you a room
  next door's `room_people` and `room_piece` as they change (`watchersOf`: everybody with the room
  open, and everybody next door to it). The client rebuilds a neighbour's shell when one of its
  pieces moves, and draws its people with this room's (`placeNext`). A seat's spot comes out of the
  neighbour's own layout, which is already in this room's frame. A standing spot goes through its
  `world()` and this room's `local()`, and a yaw the server sent in that room's own frame turns by the
  way it faces. They're tagged by name, but you can't talk to them or use their things from next door.
  A resident walking a route next door is shown where they're going, not walking there.
- **Furniture keeps out of doorways.** `keepClear` in `room-layout.js` keeps a doorway clear a metre
  into the room, so a piece laid out by the rules never stands in the way through. For that to hold,
  every layout of a room's pieces has to see its doorways: the plugin's `stageSpec` is the room's spec
  with them, and placing, stamping, `arrange`, the residents' routes and `room_view` all read it. Check
  10b in the room-stage gate furnishes a room with four doorways as full as `placeSpot` goes and fails
  any piece in a way through. With the doorways hidden from `placeSpot`, 4 of its 8 pieces landed in
  one.

Doors aren't portals yet: a shell is drawn whether or not you can see it through a doorway. Six is
cheap enough that culling can wait. Check 11 in
[scripts/shapes/room-stage.mjs](../../scripts/shapes/room-stage.mjs) builds a landing with six
doorways through the real pipeline, so the cost is checked on every push. It fails if building the
landing and its six shells takes more than 2 s of CPU. On a desktop, six 4 m shells take 110 to 220 ms of CPU to build when the Stage opens, and adding them to the room's batches takes 16 ms each time the room is built again; nobody has measured a phone. It also checks that every
doorway meets its room's across one wall, that every room comes back through it, that no wall
of the rooms beyond stands inside the landing, and that the shells add to the batches whole. The
roomstage regress checks that a middle room's `room_view` carries the rooms either side, placed
across a wall from it.

Seen in the Room Lab (`tools/modelshop/room-lab.html`, which now reads `building` from
`/api/room-lab`, with `__labVia(zone)` to step through a doorway as the server would): from Voltage's
main floor you see the VIP mezzanine through the doorway in the back wall, floor, lamp and far window,
past a thick doorway; and from the VIP room, having come through, you're stood just inside that
doorway, looking back at the main floor. With each room's furniture from content and two made-up people in the VIP room (`__labNext` puts them there), you see through the doorway the VIP bar along its right-hand wall, one of them sat in a booth chair beside it and the other stood in the room.

### Baked ahead: the rooms past the next doorway (built)

A crossing used to freeze. `ui.cross` built the next room, every room round it and each person it hadn't drawn
yet in the one frame the crossing landed in. Measured in the Room Lab on a desktop: a furnished Solenne flat is 40
to 55 ms of `buildRoom`, a hall 14, a new material 5 to 35 ms to paint, and a close-up figure 180 ms the first
time its look is seen. Lift to a hall with three flats was 170 to 200 ms, and three new people another 600.

Now that work is done before you reach the door.

- **Kept meshes** ([room-stage.js](../../client/game/js/panels/room-stage.js) `bakedMesh`). A room's mesh is kept
  under everything it was built from: the spec, the pieces, the seed and the options. `reshell` and `roomMesh` ask
  for one and only build on a miss, so a piece that moved since costs one build and never draws a stale room. The
  kept mesh is never handed to `withShells`, which adds into the batches it's given; `roomMesh` copies it first.
  They're kept by size, 192 MB on a desktop and 48 on a phone, the oldest dropped first.
- **`room_ahead`** (plugins/roomstage `aheadPayload`). After every `room_view` in a building the server sends, for
  each room one doorway away, what that room's own `room_view` would carry: its spec and the rooms round it with
  their pieces and people. It calls `viewPayload` for it with `stamp: false`, so nothing is written, and what's
  baked is what the crossing asks for. The room's own pieces aren't sent twice, nor the room you're in. It's about
  10 KB for a hall with three flats, read off the furniture cache with no query.
- **The bake** (`S.ahead`, `runBake`). From `room_ahead` the Stage queues one job for each next room's mesh, each
  shell round it, each new material (`R.prepareTexture`) and each new person's figure, rooms first. On a first
  open the loading veil stays up until the queue is empty, so this is part of the loading sequence; `VEIL_MS`
  still caps it at 4 s. After a crossing there's no veil, so a job runs once you've stood still for a quarter of
  a second, and one every 300 ms while you walk. A crossing drops what's left and the next `room_ahead` starts
  again. A lift ride's `room_view` gets one too, so the landing's flats bake while the doors open.

With the bake done, the same crossings are 15 to 45 ms: copying the room's batches, adding the shells and the
upload. A crossing you reach before the bake finishes builds what's missing, as before. The roomstage regress checks
that a room sent ahead is the room the crossing then sends. The Room Lab feeds the Stage `room_ahead` the same way
(`__labAhead = false` leaves it out), and `__labVia` now crosses with the Stage open, as the game does.

### 5. Front door and street: built

The street door is a doorway like any other (`kind: 'front'`, its `to` the facade): cut in the wall
with a dark steel frame and walked through, which sends the ordinary move. When that move lands you
on the facade, roomstage answers `room_close` with `street: true` and emits `roomstage.street`;
the client holds the room still and up. plugins/freelook answers with `freelook_open` carrying a
`stand` of `foot: true`: the GLASS free camera on its feet, unleashed, at eye height, on the doorstep
facing out along `flags.entrance`. The room closes as the street takes the pane, and GLASS's own
loading veil covers the renderer coming up.

On foot you walk at the room's pace (`FOOT_PACE` in freelook-view.js, freecam's `pace`): 5.5 ft a second
and Shift 1.9 times that, so the front door doesn't change how you move. A vantage keeps freecam's own
ladder. On foot, every tile edge is a move (`watchFoot` in freelook-view.js): crossing one sends `move <dir>`,
one at a time, and `freelook_step` says where the server put you. With no answer in 1.8 s you're put
back inside the tile you're on. A facade's door is the edge between it and its doorstep, so walking
into the building sends its way in. If that room is a Stage, roomstage opens it stood in its street
door (`via` the facade) and the street view closes; if it isn't, the street view closes onto the room
text. A walk of more than 18 tiles re-centres the window under you. `O` or `✕` ends it, as
`freelook close`, which is how it's ended for staff too. Anybody can use it, not only staff: it shows the tile
you're on and goes where you walk.

The roomstage regress walks out of the Solenne's street door, checks the street opens on the doorstep
facing out, and walks back in.

A street door can be a pair of automatic glass doors: `flags.room.street_door` `{ kind: 'sliding', w }` on the
entry room widens the doorway to `w` metres in the plan and marks it `slide`. A glass wall a doorway runs into is
cut round it (`withDoorways`), so the lobby keeps its glass front either side, with a glass transom over an
aluminium operator box. The leaves are aluminium frames with a push bar and a frosted band, lifted out of the
room's batches (`slideLeaves`) and slid on the props layer as a car's doors are: they part when you come within
2.6 m and shut 1.4 s after you leave, and you can't walk through them shut. A room seen through a doorway keeps
them drawn shut. The Solenne lobby is the first; its door row's `flags.slides` makes the move text say so.

The street outside is warmed while you're in the lobby. A GLASS view's first paints compile its shaders and build
its city, which is the loading screen. So a Stage in a room with a street door sends `room_street` a moment after
it's up; plugins/roomstage (`roomstage.warm`) finds the doorstep and plugins/freelook (`roomstage.streetwarm`) sends
the same `freelook_open` it would send on the way out, marked `prewarm`. The client builds that view hidden over
the pane (freelook-view.js `warmHolder`), paints it until its veil has gone and rests it; it takes no keyboard,
no seat ladder and no weather, and `isFreelookActive` doesn't count it. Walking out, the real `freelook_open` for
the same doorstep wakes it (`wakeWarm`) instead of building another, and the room's last frame is laid over the
pane and faded out (`closeRoomStage(..., { fade: true })`), the street showing through its glass first. The Stage
closing any other way drops the warm view. A phone doesn't ask for one.

### The street door from both sides: built, not yet seen in a browser

**Out without a load.** Three more ways into a lobby now leave a street ready behind its doors. Walk in off the
street and the view you came from is put to sleep, not closed (`parkFreelook`, on `freelook_close` with
`indoors`), and walking out wakes it on whichever doorstep the server names (`reseat`). Come down in the lift
and the Stage asks for the street as the doors shut on a ride to floor 1 (`S.warmOnRide`); the server answers
from the building's entry room whichever room asks. Open the Stage one doorway from the lobby and it's warmed
under that veil; anywhere else in the building the veil only fetches the renderer. If none of that happened,
the room stays up, held still, while the street is built behind it (dispatch.js `freelook_open`), for 8 s at
most. The page keeps its seat rung across the door both ways (`keepSeatRung`).

**In without a blank.** Walking in, the street's last frame stays over the pane (`.fl-cover`) until the room
has drawn one frame, then fades.

**The same hands.** On foot the keys are room-walk.js's: WASD, Shift to run, C or Ctrl to crouch, Q and E to
turn at the room's rate, a drag to look at the room's rate, the wheel 6% a notch. The camera's speed ladder,
lift, roll and held pointer aren't bound on foot.

**Walls and doors.** On foot, mass is solid: `footBlock` asks `groundObstructionAt` at eye height, with a
body's width, and slides along what it meets. A building with a Stage is entered only from its doorstep,
inside its doorway, with its doors apart. `streetDoorsNear` (plugins/roomstage) sends each such building's
facade tile, edge and door width with the on-foot window. The client reads the doorway off the model's own
mass (`doorway`: the front wall, the gap between the jambs, the lintel) and hands the renderer two leaves a
frame (`v.streetDoors`, glass/street-doors.js), which part at the lobby's 2.6 m and shut 1.4 s after you go.

**Bringing a building into this.** Its arm leaves the doorway empty: jambs and a lintel as mass, a frame, and
one pane for the lobby seen through it, with no leaves of its own. The Solenne is the first. After editing
the arm, `npm run lite:bake`.

### The view out, placed in the world: built

A room on a walk looks out from where the building puts it. `room_outlook` (and `room_view`'s `place`) carries
`frame`: the entry room's front wall as seen from this room (`placeFrom`), the tile edge the street door is on
(the facade's `flags.entrance`), and this room's floor in metres (a lift car's is the floor it's open on). The
client (`inBuilding` in room-view.js) stands the entry room's front wall on the tile's street edge and every room
where the plan puts it from there, at its true height, capped at the GLASS model's top. The walk moves the eye by
true metres, so the city slides past the glass as you cross a room. The eye never leaves its own tile, since only
that tile's building is taken out of the view.

One GLASS view serves a whole building. Starting it costs seconds (a worker loads the renderer and builds its
tables), so a Stage that closes onto the next room of the same building parks its view (`parkView`), the next
Stage adopts it and `place` moves its eye: a doorway, a lift ride or `room` again costs no reload. A parked view
nobody takes in 15 s is stopped. The loading veil waits for one paint of the city, not nine, and not at all in a
room with no glass; after 4 s the room shows anyway.

The room text under the Stage is rewritten on every look, and `setAreaPane` used to replace the pane wholesale,
taking the Stage with it: a lift's arrival text left the pane blank with the Stage still running on a detached
canvas. It now lifts the Stage out and puts it back. After a reconnect with a Stage up, the client sends `room`
again, since the server's viewers are RAM and a restart forgets them.

### 6. Authoring

A building needs, per room: a `flags.room` spec and its door offsets. The lint in step 1 lists every
building with its missing specs and broken doors, so the work is visible. The Studio gets a plan
view later.

## What it costs

- **Server:** one more `room_people` per neighbouring room while a Stage is open. No awaited query
  on a move; the graph and plan are built from RAM.
- **Server:** one `room_ahead` after each `room_view` in a building: a `viewPayload` for each room next door, from
  RAM, about 10 KB on the wire for a hall with three flats.
- **Client:** shells for the rooms one door away. A landing with six doors is the worst case, and
  is what the perf bench measures.
- **Client memory:** the kept meshes, up to 192 MB of vertex data on a desktop and 48 MB on a phone.

## Order of work

| Step | What changes | How it's checked |
|---|---|---|
| 1 | The building graph and its gate: readiness, bent doors, a walk with no way out (built) | `scripts/content/building-stage.mjs` in the content gates |
| 2 | `buildingLayout`, with Voltage as the test building (built) | The same gate: no overlap or mismatch, and the plan comes out the same read backwards |
| 3 | The walker crosses any door with `move <dir>`; the Stage stays open in the same building (built) | Regress: walk through, and a refused door sends nothing; room-stage gate check 10 |
| 4 | Neighbour rooms drawn through doorways, furnished and with their people (built; portal culling to come) | room-stage gate check 11: a six-doorway landing, lined up and under 2 s of CPU |
| 5 | Front door to GLASS on foot, and back (built) | Regress: out of the Solenne's street door onto the doorstep, and back in |

## Open questions

- Do neighbouring rooms' sounds come through the door (SIREN's buses), or only what you can see?
