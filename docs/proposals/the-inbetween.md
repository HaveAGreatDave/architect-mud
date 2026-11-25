# The In Between in ROOM

**Status: the place in GLASS, the arrival, the chrome attendant (faceless) and your outline of light are built; not yet seen running.** Printing in as a general effect and the fall into a vat are design.

## As built (2026-11-24)

- **A place in GLASS.** A map whose entry room has `flags.room.place` is a place: its rooms are sent with no street (`placeRooms` in plugins/roomstage, laid out by the building plan like a vessel's) and stand on their own patch of empty ground at `PLACE_AT` (200, 200), far from any region. `room world` in a place emits `roomstage.placein`, and plugins/freelook answers with the view. GLASS draws no city, ground, sea, haze or reflections round a place (gl/world.js `PLACE`).
- **The four prologue zones are one walk north**, In Between, Lattice, Broadcast, Collapse, each a `void` room (`white`, `lattice`, `black`, `collapse`). The field blends between their looks by how near you are to each (gl/interiors.js `voidPrep`).
- **It opens itself**: the prologue emits `roomstage.open` as the cold open ends (`beginArrival`), and holds the interface question until the arrival is over (`ARRIVAL_HOLD_MS`).
- **The attendant** (`flags.figure` on `npc_attendant_inbetween`): 2.3 m, limbs 8% long (`limb`), drawn close up standing (`closeup`) and watching you all the time, in mirror chrome (`chrome`). The chrome's reflection is worked out in the shader (gl/figure-hd.js uChrome): the void's whites, the floor near its feet, the tallest piece in the room, and you as an upright capsule where you stood half a second ago (freelook-view.js owChromeScene), so the light on it catches up as you move. It has no face: on a chrome figure every vertex of the head above the jaw is put on one smooth ellipsoid in both vertex shaders (gl/figure-hd.js FACELESS_GLSL), so the head is an unbroken egg of mirror and its ink follows it.
- **You, as an outline of light**: a room with `flags.room.self_look: 'outline'` draws your own body in first person as a pale blue figure of light, bright at its rim, scan lines drifting up through it and a glitter of points, with no ink line (gl/figure-hd.js uOutline). It ends when the room's `self_look_until` message comes (`morphex_close`: MORPHEX has made you flesh), through client/shared/self-look.js.
- **The arrival** (gl/room-void.js, 12 s, Escape skips): black, then points of light gather into a body 2.4 m ahead of you, the white rises from your feet, the floor forms, the room prints in from the floor up with a scan slice at the edge, its people appear at 8 s, and the body rushes into your eyes. A place not drawn for 5 s arrives again.

The In Between (`zone_the_inbetween`) is the first room every new player sees, before the Lattice, the Broadcast, the Collapse and waking in the Coldwater Clone Facility. Today it's a box with the default walls, a boards floor and, by mistake, a shopfront window. This doc makes it the best interior we have. The Clone Facility is the bar on detail. This room has to clear that bar without having walls to hang detail on.

The zone's own words are the brief:

> No floor, but you're standing. No light, but you can see. White on white in every direction, edges that won't stay put.

Then the ambient events: a wire of light carrying a voice, the attendant listening, a floor that's there for a moment and gone, and the terminal humming a chord that turns into your name.

## What you see

1. **No walls, no ceiling.** White in every direction, but not flat white. There's a very slow gradient of warm and cool whites, so your eye always has something to focus on and never finds where it ends. Nothing is drawn at the room's bounds.
2. **A floor only where you stand.** A disc of pale, faintly ruled surface forms under your feet as you step and fades about a metre behind you. Each footfall sends out one thin ring, like a drop on still water. Your shadow is the only hard dark in the room. The attendant and the terminal each have a disc of their own that doesn't fade.
3. **Edges that won't stay put.** Thin grey lines draw themselves in the white: the corners and floor lines of a room. They grow, hold for a second and pull back, and they never close into a box. They're the Clone Facility's own plan lines, read from `zone_start`'s `flags.room`, so the room you're about to wake in is sketching itself around you before you've been there.
4. **The chrome attendant.** A tall figure in seamless mirror chrome with no face. It reflects a world that isn't in the room: the green vats, the gantry and the tile of the Clone Facility, faint and blurred, as if the chrome remembers somewhere else. **Its light moves half a second late.** Its reflections and highlights are sampled from where you were 0.5 s ago, so when you move, the light on it catches up.
5. **The MORPHEX terminal, grown from the same chrome.** The existing `morphex` pod drawn in the attendant's chrome instead of carbon and dark metal, with chrome roots running from its plinth into the place a floor would be. The pod's sequence (`panels/room-morphex.js`) is unchanged.
6. **Wires of light.** Now and then a thin filament of light drifts past at the edge of the view, a ribbon with a bright bead running along it. When one passes close you hear a fragment of a voice through ORACLE, too quiet to make out.
7. **The way north.** North, the white thins into pale blue, and the Lattice's grid shows through faintly, like lines through paper. That's the exit. Walking north is an ordinary `move north`.

## The beats

The room's four ambient events become events in the picture, played when the server sends the line, so the text and the room agree:

| Line | What happens in the room |
|---|---|
| A wire of light drifts past… | A filament passes within 2 m of you, with the voice fragment. |
| The attendant tilts its head… | The attendant's head tilts and holds. The tilt starts 0.5 s after the line, like its light. |
| For a moment there's a floor… | For 0.6 s the whole plane is the Clone Facility's grey tile, lit by its vats, then it dissolves outward from your feet. You don't fall. The camera dips 2 cm and comes back. |
| The terminal hums a chord… | SIREN plays a soft chord off the terminal. ORACLE says your character's name inside it, then the chord loses it. |

The attendant's voice arrives before its mouth moves, as the description says: when it speaks, ORACLE's line starts and the chrome where a mouth would be moves 0.5 s later.

## How it's built

- **The spec.** `flags.room.void: 'white'` on the zone. With `void` set, `room-mesh.js` builds no walls, ceiling or floor, and `room-layout.js` still gives the walkable bounds (about 12 by 12 m). It's generic ROOM: `'black'` would serve the Broadcast.
- **A layer of its own, `gl/room-void.js`.** Made the first time a room has `void`, the way `gl/room-vat.js` is made for vats in `gl/room.js`. It draws the white field as a full-screen pass behind everything, the discs under feet with their rings, the plan lines and the filaments, and runs the beats.
- **The chrome.** A mirror material that reads a small environment cube painted once from the Clone Facility (offscreen, from `zone_start`'s spec, the same way `room-outlook.js` paints a view). For the half-second lag, the layer keeps the camera's last 0.5 s of positions and the chrome is shaded from the old one. The cube is painted once and never per frame.
- **The attendant's body** comes from the figure generator in a chrome skin, so it has a person's proportions and no face. `npc_attendant_inbetween.json` gets `flags.look.skin: 'chrome'`.
- **The beats** come from the ambient lines the server already sends. The client matches the line to a beat. Nothing here decides anything on the server.
- **Sound.** A near-silent high bed in SIREN, the footfall rings as soft glassy ticks, the filament voices through ORACLE, and the terminal's chord.

## Phones and weak GPUs

No lag on the chrome (it reflects the cube as is), half as many filaments, no rings, and the floor beat plays as a flat tile texture with no vat light. The white field and the discs always draw, because without them there's no room.

## Fixes on the way in

`zone_the_inbetween.json` carries a shopfront `window` and `floor: 'boards'` it shouldn't have. Both go. `always_lit` stays.

## Phases

1. The spec and the void layer: the white field, no shell, discs under feet and under the two pieces, the bad flags gone.
2. The chrome: the attendant's figure, the terminal in chrome, the remembered Clone Facility in the reflections, the half-second lag.
3. The plan lines, the filaments and the four beats, synced to the ambient lines.
4. Sound, the voice before the mouth, and the blue thinning to the north.

Each phase is checked in the Room Lab (`/room-lab.html`) against this doc, with a screenshot, and `scripts/content/building-stage.mjs` and `client:smoke` must pass.
