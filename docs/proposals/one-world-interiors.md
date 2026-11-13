# One world: rooms inside GLASS

> **Status: step 1 built (the layer, the placement, the streaming and a Modelshop prototype, `__interiors`) and step 4's first cut built behind a switch (`__oneWorld(true)`); steps 2, 3 and 5 are design.** It replaces the two-renderer split the [Building Stage](building-stage.md) has today.

## The problem

ROOM and GLASS are two renderers. A room is drawn on its own canvas in metres with its own camera, and the city is a picture GLASS paints for its windows (`room-outlook.js`). The front door swaps one canvas for the other and fades between them. However well the picture is lined up, it's a picture, and the swap at the door is a seam you can feel.

## The answer

Draw the rooms in GLASS 2's own scene: one camera, one depth buffer, one sun. A window is glass with the real city behind it, and a doorway is a doorway.

Rooms load only when you're near them, and further off they're drawn more simply:

| Distance from the room's box | What's drawn |
|---|---|
| up to `INTERIOR_TUNE.near` (0.9 tiles) | the whole room: its mesh from `gl/room-mesh.js`, furniture and all |
| up to `INTERIOR_TUNE.mid` (3.5 tiles) | a lit box: floor, walls and ceiling in the room's tones, its lamp at night |
| further | nothing: the building's own GLASS model stands for it |

A room is built the first frame the layer wants it, `INTERIOR_TUNE.budget` (1) a frame, and let go about four seconds after it drops out of range. At most `maxNear` (8) rooms are whole at once.

A whole room's mesh and its materials' pictures are built in a worker (room-mesh-worker.js, the one the Room Stage bakes ahead in), not on the frame: `meshReady` in room-interiors.js asks for it, and until it's back `interiorsFrame` draws the room as its box. Built on the page it was 40 to 60 ms a room warm and about 200 ms cold, so walking up to a building with a few Stage rooms was a run of long frames. Measured in Chrome on 2026-11-13: the Solenne's 21 rooms took about 14 s of cold worker time between them, and then handed the layer their parts in under a millisecond. The meshes are kept by room and lamp (32 of them), since a push makes the room objects again. With no worker (Node, the gates) a room is built on the spot as before.

## How it fits together (step 1, built)

- `room-view.js` `roomToGlass(L, origin, bearing, floorM)`: the 4×4 from a room's own frame to GLASS tiles about its building's tile, and `roomOrigin(frame, bearing)` for where its front wall stands. These are the window view's own sums (`viewOf`, `inBuilding`), and `scripts/client/interiors-smoke.mjs` holds them to each other.
- `room-interiors.js` `interiorRoomsOf(data)`: a building's rooms (spec, furniture rows and `frame`, as `plugins/roomstage` `frameOf` works it out) as entries with a matrix, a bounding box and `parts(lod)`.
- `glass/interiors-near.js`: `pickInteriors` (pure; which rooms, at which level) and `interiorsFrame` (moved to the map window).
- `gl/interiors.js`: the GLASS 2 layer. Uploads by key, draws on the scene's depth buffer after the solids, lit by the frame's day and sun and each room's lamp.
- The wiring: `v.interiorRooms` on a view → `interiorUpload` in `windshield.js` → `opts.interiors` through `gl/install.js` → `drawInteriors` in `gl/world.js` and `gl/context.js`.
- The prototype: `__interiors({ zone })` on the Modelshop's street tool (`tools/modelshop/street.js`), fed by `/api/building-rooms`. It stands you in a room with its own building taken off the map, or outside its door with `outside: true`.

## The live view (built, the default on a desktop)

Until a room is drawn in GLASS itself, the Room Stage gets the same look another way: `room-outlook.js` with `live` paints the city on the main thread every frame there's glass in view, from the room's own eye (where you stand, your yaw, pitch and lens), under the room's canvas with its panes as holes. There's no picture, no lag and real parallax, and every Stage feature stays. It costs a GLASS frame a frame, as the street on foot does. Phones, and `__roomFaces = true`, keep the six faces painted in the worker.

## What's left

2. **Windows in the shell.** From the street a building's model is solid, so its loaded rooms are hidden behind it except through the open street door (a Stage building's arm leaves its doorway empty). Either cut the panes out of the shell where a room is loaded, or draw the facade's windows with interior mapping (a fake room looked up per pixel behind the glass) as the far level. Interior mapping is the cheaper and more usual answer and needs no geometry.
3. **The shell round you.** Taking the whole building off the map works for one room; walking from room to room needs the shell drawn round the loaded rooms, or cut away only where you stand.
4. **The walk.** *First cut built, off by default.* On foot the server sends each nearby building's rooms once with the street window (`plugins/roomstage` `buildingRoomsNear`, `plugins/freelook` `interiorsFor`), and the street view draws them. With `ONE_WORLD.on` (`__oneWorld(true)`), the `room_view` for a drawn room is taken by `freelookTakeRoom` instead of opening the Stage: the building comes off the map, you stand just inside the door, the rooms' floors hold you (`roomFree`), a doorway between rooms sends its move, and the street door sends yours out. Still to come: the Stage's verbs, people, lights and lift on this path. The rest of the plan: the street view on foot (`freelook-view.js`) draws the interiors, and walking through the door stays in GLASS instead of opening the Room Stage. The Stage's verbs, people and lights move onto this path one at a time, and the painted window view (`room-outlook.js`) goes.
5. **Lighting and textures.** The layer uses mean colours for textured materials and a small light model. The Room Stage's per-lamp light, textures and comic ink come across once the placement is proven.

Phones stay on the Room Stage and the painted view until GLASS Lite can carry the rooms.
