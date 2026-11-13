# Street people: one look, four levels

**Status: steps 1 to 3 built (one look on the wire, the crowd dressed from it, the close-up level in GLASS); steps 4 to 6 are design.** It answers the "street's own close-ups" question in [hd-figure.md](hd-figure.md#open-questions) and replaces the token rule in [street-figure-heads.md](street-figure-heads.md#what-doesnt-change).

## Why

David asked (2026-11-12) for ROOM's people and GLASS's to be one thing: the close-up figure near you, a lower level of the same person further off, a bake past that, and a person you'd recognise going down the street because you saw them on TV.

Before this, the two were strangers. The Room Stage and the TV dressed a person off their id (`lookOf` in [gl/room-people.js](../../client/game/js/panels/gl/room-people.js)) with their settled look (`flags.figure`), and drew them with the close-up figure. The street dressed every figure off an anonymous token salted per boot, with `actorOutfit`'s own rolls, so the same NPC wore one coat on the news and a different one on the pavement, and was never more than the crowd's baked body however close you stood.

## The decision: recognition over the tracker rule

The salted token existed so a street figure could never be followed back to a name: a recognisable figure is a live position for every named NPC in the city, readable from the air with no camera, contact or skill check ([world-rendering.md](../reference/world-rendering.md)). Recognising someone on the street is the same fact seen from the other side, so the two can't both hold.

David chose recognition everywhere (2026-11-12), over two narrower options: real looks only within a tile or so of the viewer, and real looks at any distance only for public faces. The id still never goes on the wire, but anyone who hashes a name can find that person.

## The ladder

Every level is drawn from one look, so a person crossing from one level to the next keeps their coat, hair, skin and silhouette.

| Level | Drawn by | When | Cost a person |
|---|---|---|---|
| close-up `hd` | the Room Stage's figure ([gl/figure-hd.js](../../client/game/js/panels/gl/figure-hd.js)) through [gl/street-hd.js](../../client/game/js/panels/gl/street-hd.js) | over `STREET_HD.px` (260 device px tall) and within `FIGURE_LOD.near` (3.1 m), at most `STREET_HD.max` (6) | about 28,000 triangles, posed on the CPU, one draw and its ink |
| close-up `lite` | the same | over 260 px, past 3.7 m | about 5,000 vertices |
| crowd | the baked body and the street's heads ([gl/actors.js](../../client/game/js/panels/gl/actors.js)) | over `actorMeshPx` (8 px) | 1,961 vertices, instanced, no CPU |
| far | the far body | 1.5 to 8 px | 387 vertices, instanced |
| billboard | the canvas card in the coat's tone | under 1.5 px | a quad |

At the street's 1.776 m a 260 px figure has a head about 34 px tall, where the crowd's head reaches its finest level (L0). That's where the close-up face starts to add something.

## One look (built)

- **The wire.** `t` in the street feed ([server/engine/street-actors.js](../../server/engine/street-actors.js)) is the FNV-1a hash of the id in base 36, exactly the seed `rand(id)` mixes in gl/room-people.js. `s: 1` marks a woman (the close-up head and build roll off it). `g` is a settled look, an NPC's `flags.figure` or a player's MORPHEX figure (`playerFigure`), sent only for the few who have one: 13 NPCs today, most of them the TV's people. The feed is a few bytes a figure larger than before.
- **The seed.** `rand('#' + t)` in gl/room-people.js reads the hash straight, so a street figure rolls what the same person rolls in a room or on the TV.
- **The crowd's dressing.** `streetLook(t, female, figure)` runs `lookOf` as the Room Stage does (sculpted, the person's sex and settled look) and hands back `actorOutfit`'s shape in sRGB: coat, trousers, skin, hair and shoes from the close-up slots, the cut, the face's layout, makeup, hair style, lips and iris, and `hd`, what the close-up level draws them with. windshield.js `streetActorPose` dresses everyone with it, and a changed `s` or `g` dresses them again.
- **Height.** A settled `flags.figure.height` sets the crowd's own scale (over the crowd's 1.776 m) as well as the close-up figure's; anybody else keeps the crowd's five per cent either way, which the close-up level copies.

- **Bare legs.** The crowd's body is always in trousers. Where the close-up look has shorts or a skirt, its trousers lean toward the skin by the share of leg between the hem and the boot (`bare`, up to 0.75), so a figure in shorts doesn't turn into one in dark trousers as it walks off. About three in eight people roll short bottoms.

Not carried: the occasion and weather changes the Room Stage adds (`figure_work`, `figure_cold` and `wear`). On the street a person wears their own look.

## The close-up level in GLASS (built)

[gl/street-hd.js](../../client/game/js/panels/gl/street-hd.js), made by gl/context.js beside the actor layer.

- **Who.** `pick` runs on the frame's actor records before the crowd uploads: anybody close-up (`lod` 0) over `STREET_HD.px`, tallest first, up to `max`, dropping back under `off` (0.8) of the line so nobody flickers on it. Each chosen record is marked `hd`.
- **Two frames.** A room is metres with Y up; the street is map-window tiles with Z up, and the crowd's body is placed in it mirrored (forward F, its left hand on (F.y, -F.x)). The figures are posed in a room frame laid on the street about the eye's foot: room X along tile x, Y up, Z along tile y, the same mirror, so the close-up figure's left hand is where the crowd's is. A crowd heading `hd` is room yaw π/2 − hd. `M` takes the room frame into tiles and the street's view-projection does the rest.
- **The pose** is the Room Stage's own `figurePeople`: the record's clip and phase, the person's look and height, their blink and gaze, and their head turning to whoever comes close (`NOTICE`). `eye` lets it drop to `lite` past 3.7 m.
- **The light** is the room's chunk ([gl/room-light.js](../../client/game/js/panels/gl/room-light.js)) told about the street: the sun or the moon as a lamp 200 m along the key light, the nearest street lights as tinted lamps, each brought to about the strength the crowd gives it at half its reach, no panes and no indoors. `uStreet` leaves out the room's vignette (1) and also hands linear light to GLASS's float target (2); a room leaves it at 0 and is unchanged.
- **The crowd hides them** in the main pass only: a record drawn close up goes up with its brightness negative, and `uHideHD` puts it off the screen. The mirror and the ink's depth prepass still draw the crowd's body for them, so a puddle reflects them and the city's ink lines don't draw through them.
- **Nobody blinks out.** figure-hd.js is imported the first time somebody is close enough, not with GLASS, because it declares its ~114k-character lit shader for the prewarm of every new room and rink context (last, behind their own programs; `gl/programs.js` scenes). Until the program has linked (about a minute cold on Direct3D, a couple of seconds from the driver's cache), the crowd draws everybody.
- **Built off the page.** A person's figure is 50 to 180 ms to build and 20 to 40 ms more for its occlusion, at each level. Built on the frame somebody first came close (and again when they dropped to `lite`), that was a hitch a passer-by. `pick` now draws close up only somebody whose two figures are built (`figureLooks` in gl/room-people.js names them); anybody else is asked for ([figure-ahead.js](../../client/game/js/panels/figure-ahead.js)), built and occluded in [figure-worker.js](../../client/game/js/panels/figure-worker.js), and stays in the crowd meanwhile. With no worker (Node, the gates, a GLASS inside a worker) the figure is built on the spot as before.
- **Phones** keep the crowd: GLASS Lite leaves street life out there already.

**Measured (2026-11-12).** Posing costs about 0.4 ms of CPU a person a frame (`figurePeople`, six people 2.4 ms in Node on a loaded machine), which is why `max` is 6 and why step 4 comes next: GLASS is CPU-bound. In headless Chrome on SwiftShader the program linked 12 to 55 s after first use; until then the crowd drew everybody, and once it had, the close-up figure stood exactly where the crowd's had, facing the same way at the same height.

**Measured again (2026-11-13).** Two-thirds of that was `fk` in actor3d.js making eleven `Float64Array`s a bone, with a walk running it twice. It now works in scratch matrices with the same sums in the same order (the bake and every clip come out bit for bit as before), and six people pose in about 0.6 ms in Node, 0.1 ms a person. On foot on Marrow Street with six close up, the close-up level is about 6% of the frame's CPU. In headless Chrome the figures came from the worker a second or two after somebody came close, and the close-up count filled in as they did.

`__streetHD.tune` and `__streetHD.stats` (`cand`, `drawn`, `poseMs`, `ready`, `tallest`) are on the console.

## Checks

- [scripts/shapes/actors.mjs](../../scripts/shapes/actors.mjs) section 2b: for a man and two women with settled looks and a player with none, `streetLook` off the token and `figurePeople` off the id agree on coat, trousers, skin, hair, shoes, cut and face, and the close-up level would draw the token's look. The record keys allowed grew by `px` and `s0`.
- plugins/flight/regress.js: the feed is still 1:1 and the token still isn't an entity id.

## Still to do

4. **Pose on the GPU.** `figurePeople` poses each close-up person on the CPU every frame (`streetHdStats.poseMs`), which is what limits `max`. The crowd's bake already writes the head and neck bones a frame (`bk.bones`); writing all 19 would let the close-up level skin from the same texture with only the reach and the head turn left on the CPU, and let `max` grow.
5. **Instanced close-ups.** figure-hd.js draws one person a call with ~60 uniforms each. A per-instance buffer for the look (colours, surfaces, face) would draw a cut and hair style in one call.
6. **Bakes past the far body.** A real impostor of each look (a few angles of the close-up figure rendered to an atlas) could replace the canvas card and the far body at a few pixels, so a coat's colour and cut read further off than 8 px.

Also open: the close-up figure has no fog of its own (it's within a few metres, so it hasn't mattered), the walk's phase is the crowd's stride while `figurePeople` may pick a gait with its own, and a player's look reaches the street only through MORPHEX's figure keys.
