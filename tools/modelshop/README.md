# The Modelshop

**STATUS: BUILT — an inspector, an authored model format, a differ, and an editor with a
3-D viewport (orbit/pan/zoom, move/scale/rotate, keyboard). Buildings are edited as geometry;
the nine generated vehicles are edited as parameters, and both save to content. Phase 5, the
port of the hand-written building arms, was attempted, measured and abandoned on the evidence —
the tooling for it ships, the ports do not.**

```bash
npm run modelshop          # http://localhost:5181
npm run modelshop -- 5200  # another port
npm run dev                # server :3000, Studio :5180, Modelshop :5181
```

Local-only. Do not expose it. There is a link to it in the dev panel sidebar (🏛 Modelshop),
which starts it for you the way the Map Studio link does.

## Getting around

| | |
|---|---|
| middle-drag | **locked orbit** — the model stays pinned at the centre |
| drag empty space | the same orbit |
| shift+middle, or right-drag | pan |
| wheel | zoom |
| click a piece | select it, and its card in the rail |
| drag a piece | apply the active transform to it |
| <kbd>G</kbd> <kbd>S</kbd> <kbd>R</kbd> | move / scale / rotate |
| <kbd>Shift</kbd>+drag | the vertical of whatever transform is active |
| <kbd>D</kbd> / <kbd>Del</kbd> / <kbd>Esc</kbd> | duplicate / remove / deselect |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | undo / redo |
| <kbd>O</kbd> / <kbd>T</kbd> | the model browser · show or hide the tool palette |
| <kbd>F</kbd> | re-frame |

**Every model arrives framed.** The framing is SOLVED, not guessed: the model own bounds go to
`previewFit()`, which returns the distance that fills the picture on whichever axis is tight. It
used to be a formula off the roof height, which suited a mid-rise and left a shed tiny and a spire
cropped — so Frame was a repair rather than a convenience. It is a convenience now.

⚠ **A vehicle is scaled UP, not approached.** These meshes are authored to read as a contact seen
from an aeroplane — a rig stands about 0.05 tiles tall — so no camera distance makes one fill a
screen; the projection own near clamp stops you first. The preview picks a `sizeMul` instead and
frames that. And the fit is padded, because the PAINTED craft is bigger than its face list: prop
discs, lamp glows and the ground shadow all draw outside the vertices `vehicleBounds` can see. That
pad is measured — unpadded, six of ten classes spilled past the frame while the three smallest sat
correctly at about 0.7.

There is no pitch in this projection, so **arcing the eye IS looking down** — the same camera
the cockpit and the cab have. Which is exactly why the middle-button orbit has to be *locked*:
`sy = horizonY + depth·(EH − wz)/f`, so raising the eye slides the picture DOWN the screen and
an unlocked orbit walks the model off the bottom. Locking it is one line of algebra rather than
a second camera — solve the horizon shift that keeps the model's own mid-height at the centre:

    panY = H·0.08 − H·0.55·(EH − zMid)/dist

Measured on the same drag: locked holds the subject at 0.61 of the frame, unlocked drifts to 0.86.

⚠ **Everything that paints the viewport goes through one function**, and that is not tidiness.
Spin used to call the building renderer directly, so hitting it while looking at an aircraft drew
a *building*: `modelOf()` returns a stub record for a vehicle key, `drawTypeModel` finds no arm
for its type, and the switch falls through to the default shop arm. A second call site is a
second chance to forget the branch. Scale and rotate are horizontal drags with Shift for height;
height can never be a free drag because there is no depth cue to judge it against.

## The tool palette

A floating panel, not a dialog — it was a modal picker first, and a modal is a thing you open,
take one action from and dismiss, which is exactly wrong for the surface you choose a tool from
*while* you work. It stays open over the viewport, drags by its head to anywhere on the stage,
closes with its x and comes back with the **Tools** button or <kbd>T</kbd>. Where you put it and
whether it is open are remembered per browser.

Every tool is an icon with a tooltip carrying the name and the sentence the labelled tile used to
show. That is what lets the panel be small enough to leave open: sixteen labelled tiles is a panel
the size of the rail.

Its two lists are read from the schema, never from a list of names in the panel — a kind added to
`SEG_SCHEMA` or `ADORN_SCHEMA` gets a button with nothing else edited. Add-mass and add-adornment
tools grey out on a hand-written arm, and the tooltip says why. A piece added here and a piece
added from the rail share one `defaultPart()`, so both arrive the same size.

## The GL spike

Press <kbd>G</kbd> (or the **GL** button) and the same model is drawn again through WebGL2, over the
2-D picture, at the same camera. It exists to answer one question with evidence rather than
argument: **should GLASS stop being a 2-D painter and become a real 3-D renderer?**

Four criteria were set before any of it was written. All four are now answered.

**1. Is it the same camera?** GLASS projects by hand — `sx = cx + FL·(l/f)`,
`sy = horizonY − depth·(u/f)` — which is not an approximation of a perspective camera, it *is* one:
a pinhole with two focal lengths and a principal point well above centre, because the horizon is.
[client/game/js/panels/gl/camera.js](../../client/game/js/panels/gl/camera.js) writes it as a 4×4 and
`npm run gl:parity` checks it: **2,811 projections across nine headings, four eye heights, five
pitches and three chase offsets, worst disagreement 4.9×10⁻¹⁰ px.** A deliberate 0.1% focal error
fails the gate. This mattered more than it looks — a second renderer drawing the same city through a
slightly different camera would look like an improvement and *be* a regression, since collision, the
shadows, the occlusion field and the cold open all read the same geometry.

**2. Is it the same building?** `MESH_SINK` is `SHAPE_SINK` one level lower: with it set, a mass
primitive records its faces in world space and returns without painting, so the vertices come out of
the code that already draws the city rather than from a second opinion about what a box is.
`npm run gl:mesh` holds it against the captured shape the sim collides with: **7,977 faces / 16,856
triangles over all 173 models, every one agreeing, no kinds missing.**

**3. Does it cost less?** Measured in the browser with `__glBench()`, on a 73-building city:

| | |
|---|---|
| the 2-D building pass | **3.6 ms** (measured as the same map with the buildings minus without) |
| the same geometry in GL | **0.02–0.04 ms** |
| GL at 100× the triangles (286,600, all on screen) | **0.67–1.06 ms** |

So a hundred times the detail still costs a third of what today's renderer costs at one times. The
criterion was 3× headroom; the answer is about two orders of magnitude.

**4. Does it look like the same city?** Silhouette agreement between the two renderers at one camera,
sampled over the frame: office 100%, warehouse 100%, halcyontowers 98.3%, the KSAB sound stage 95.9%.
The warehouse read 83.7% until barrel roofs were added to the mesh sink — the coverage gap and the
fidelity gap turning out to be one fact seen twice, which is the sort of agreement that makes a
measurement worth trusting.

**And it wears the right surfaces.** GLASS already bakes every texture it uses — one 16×32 canvas
per palette per day/night, nine procedural painters, the window grid on top — so the GL path asks
for those exact canvases (`wallTexMixed` for a wall, `roofTex` for a roof, because the roof is a
second generator) and packs them into one atlas. A draw call binds one texture, so per-face binds
would make a skyline several hundred draw calls and throw away the only thing being proved.
[gl/atlas.js](../../client/game/js/panels/gl/atlas.js) also carries GLASS's own vertex-light ramp
into the shader — `wallLit`'s two overlays, per fragment instead of as a canvas gradient.

With textures and that light, the two renderers agree to a **mean colour difference of 6.8–12.7%**
over the shared silhouette. The ramp is what closed the worst case: Halcyon was 21% with a flat tint.
What is left is the fog term, the exact alpha compositing and texture filtering — porting detail,
not spike questions.

⚠ **What the spike deliberately is not.** No adornments, no ground, no weather, no near tier, and not
wired into `paintWindshield` at all. It answers whether the same city can be drawn with a depth
buffer from the same seat, and stops.

⚠ **Three ways it drew nothing before it drew anything**, each with no error to go on, and each now
written into the file it happened in: `renderModelPreview` returns a *wrapper* (`{cam, dx, dy}`), so
reading `FL` off it gives `undefined` and a matrix of NaN; the mesh is model-local and centred where
the camera stands; and an axis swap added as hospitality to a GL convention the matrix does not use.

⚠ **And three ways the benchmark lied before it told the truth.** `gl.finish()` on a canvas nobody
composites returns instantly, so every scale reported an identical 0.005 ms — 2,866 triangles and
286,600 cannot cost the same, which is how the measurement announced it was not one; a `readPixels`
stalls properly. Tiling the city outward put the extra geometry outside the frustum, so 100× measured
*faster* than 10× — the copies now land on the same buildings. And the readback is not free, so it is
measured against an empty scene and subtracted. The first run of a session is still noisy; take the
second.

## GLASS 2 in the game

### Turning it on

In the sim, click **⚙** at the top right of the flight view and find **GLASS 2 (WebGL)** under
**▦ WORLD RENDER** (that section is open by default). It is a 0/1 slider and takes effect on the
next frame.

From a console, `__wsTune.gl = 1` — `__wsTune` IS `RENDER_TUNE`, so the write lands immediately.
`__wsTune.gl = 0` puts it back.

The flag is shared by every seat that has not overridden it, so **the truck cab picks it up from the
same switch** — the cab has no ⚙ panel of its own. A view can pin its own answer with
`tune: { gl: 1 }`, since `gl` is in `VIEW_TUNABLE`.

⚠ **`__glass2()` in the GAME console says why it went quiet.** GLASS 2 switches ITSELF off on any
failure and the very next frame looks entirely normal, so "I turned it on and the view went" always
arrives with the console line long scrolled away. One call reports what the machine can do, whether
the pass is installed, what the flag is now, what the last frame drew, and what it last died of.

⚠ **And a throw can no longer take the sim with it.** `paintWindshield` is called from the flight
loop, so an exception in the world pass does not merely spoil a frame — it kills the loop, and the
pane stops painting, stops resizing and stops responding, which is what "the 3-D window will not
load" looks like from outside. With the flag on, a throw switches the pass off and finishes the
frame in 2-D. With the flag OFF it still rethrows, deliberately: swallowing there would hide a real
bug in the renderer that ships.

In the Modelshop (`npm run modelshop`, :5181) the console carries the measurements: `__glCaps()`
for what the machine can do, `__glPhases()` for where the frame goes with the flag off and on,
`__glStage1()` for the end-to-end saving, `__glFidelity()` for how close the two pictures are,
`__glFloor()` and `__glFloorCost()` for the same two questions about the ground, `__glSign()` for
whether the buildings still have their names on them, `__glLights()` for whether a sign lights the
wall it is bolted to, `__glClouds()` for whether the deck is still the same sky,
`__glFrame()` for where the whole frame goes
now, and `__glBench()` for the original ceiling question.


The spike answered its four questions, so the pass is wired into `paintWindshield` behind
`RENDER_TUNE.gl` — the **GLASS 2 (WebGL)** slider in the flight-sim render knobs, or `__wsTune.gl = 1`
from a console. Off is the absence of a code path: no canvas is made, no context is asked for, and
`shapes:framecost` is unchanged to the call.

On, the city's **mass** is drawn in WebGL2 and every light, sign, adornment, marquee, ground pass
and HUD is still painted by GLASS over the top. The seam is `MASS_OFF`, which is not new — it is how
the distance LOD has always drawn a far building's neon without its walls.

Measured end to end, `__glPhases()` and `__glStage1()` in the console. A truck asks for a 33-tile map
window and an aeroplane for 73, and the GL buffer holds the whole window, so both are worth reading:

| | 2-D | GLASS 2 |
|---|---|---|
| the whole frame, 33-tile window | **5.7 ms** | **2.4 ms** (−58%) |
| `world:build` (queueing) | 4.34 ms | 1.78 ms |
| `world:flush` (the sort + paint) | 2.21 ms | 0.56 ms |
| `world:gl` (draw + composite) | — | 0.13 ms |
| the whole frame, 73-tile window | 21.8 ms | 13.6 ms |
| a buffer rebuild, 1,964 faces | — | **0 ms** (11.1 ms before the fill was fixed) |
| buffer rebuilds over 48 steady frames | — | **1** |

⚠ **THE BUFFER IS THE WHOLE THING, AND THREE SEPARATE MISTAKES REBUILT IT EVERY FRAME.** A city is
static geometry; the entire argument for a vertex buffer is that it is uploaded before the first
frame rather than during it. Each of these drew a perfect picture and threw the argument away, and
none of them could be seen — only `glLastFrame().builds`, which the pass now reports, tells them
apart from a buffer uploaded once.

- **The key was order-sensitive.** Cells arrive far-to-near, so the same city seen nine degrees
  round is the same set in a different order. Sorted now.
- **The mesh was built at the camera-relative position.** `dx` is `(rx − R) − cam.ox` and moves a
  fraction of a tile every frame you drive, so the mesh was stale before it was uploaded. It is
  built at the MAP WINDOW tile instead, which holds still until the server recentres, and the
  sub-tile offset goes onto the camera through the `fx`/`fy` terms the chase camera already had —
  no new matrix, and no new code in the file the parity gate holds still. `gl:parity` checks that
  shift too: 420 of its 3,231 projections are drawn from the window's frame.
- **The set was whatever survived the 2-D culls.** The lateral frustum test and the occluder
  pre-pass both change their minds as the heading turns. The GL set is now the whole window,
  collected at the top of the sweep before any camera question is asked — a GPU discards what is
  off screen or behind something for nothing, and a rebuild costs milliseconds.

⚠ **AND A REBUILD IS NOT RARE ENOUGH TO BE ALLOWED TO BE EXPENSIVE.** The map window recentres as you
drive, and the dynamic-resolution dial resizes the canvas under it — each one a full rebuild. At an
aircraft's window that was **11.1 ms**, a dropped frame invisible in any steady measurement. Two
things, both in how the vertex data is written rather than in what it holds: the buffer is filled
into a `Float32Array` directly instead of `push`ing a hundred and forty thousand numbers into a
plain array and converting, and a tile is handed over as its SHARED face list plus an offset rather
than as a copy of every face moved into place. A rebuild now measures at zero.

⚠ **AND TWO WAYS IT DREW A CITY NOBODY COULD SEE.** Both passed every counter in the harness.

- **A canvas under the 2-D one is invisible**, because the 2-D pass paints an opaque sky and an
  opaque ground over the whole frame. Putting it on top is not the fix either: the mass would then
  cover every light and sign, which are painted before it and belong in front of it. Neither
  stacking order is the painter's order, so the GL canvas never joins the document at all — the
  pass draws into it and `drawWorldObjects` blits it at exactly the point the mass used to be
  queued, after the ground and before the flush. The blit rides the current transform, so the bank
  rotation and the turbulence shudder come free and the GL camera never learns about either.
- **`MASS_OFF` was global over the loop**, and GL only takes tiles that resolve to a MODEL. A
  building type with no model of its own — `luxtower` is one — falls through to the shared biome
  archetype, has no mesh on the GPU, and was deleted from the city. It is per building now.

**And the far edge dissolves.** The 2-D pass fades a building out over the last five tiles of its
draw distance so distant blocks ghost up out of the horizon, and that distance is a property of the
WINDOW — 15 tiles from a cab, 34 from a cockpit — not a constant. The GL buffer is composited onto
that same frame, so mass that stayed opaque to its last tile painted a hard edge over the haze the
rest of the picture dissolves into; the shader takes the draw distance, the fade band, and GLASS's
own fog colour, amount and 6..34 curve, and writes premultiplied alpha. One thing is deliberately
not carried over: the 2-D fade staggers each tile by up to three tiles so a row does not dissolve in
unison, and the GL edge is the unstaggered one.

### Stage two: the detail is free

Adornments are not one thing. Half of them are SURFACES — the panels, bands, louvres, sills, coping,
jambs and soffits every piece of trim is actually built out of — and half are LIGHT: neon, glow,
bloom, painted signage, holo. The surfaces belong in a mesh; the light does not. Stage two moves the
first half and leaves the second exactly where it is.

One function does it. Every one of those surfaces is drawn by `emitFlat`, so `emitFlat` records into
`MESH_SINK` when a capture is running and returns without painting when GLASS 2 took the building —
`FLAT_OFF`, which is `MASS_OFF` for things that are not mass. ⚠ **The suppression test is the capture
test**: a quad whose fill is not a plain colour (a gradient, or a stroke-only outline) is not in the
mesh, and a blunt flag would have deleted it from the world instead of moving it.

⚠ **AND THE MESH CAPTURES AT THE NEAR TIER.** `ADORN_NEAR` is the detail that only reads from arm's
length — a recessed doorway with a frame, glazing behind it, sills, a head soffit, mullion bars, a
threshold step. The tier exists because running it on every building at every distance is what the
2-D renderer cannot afford; a mesh built once and drawn through a depth buffer has no such problem,
so **the truck driver's detail is simply always there now**. The city went from 1,191 to 2,133 faces
on the GPU at the same cost — `world:gl` stayed at 0.13 ms — and the frame from 5.1 to **2.0 ms**.

⚠ **The capture offset has to follow the entrance, and for a long time it did not.** The arm is run
displaced from the origin so its front faces the stub camera, because sixty arms gate part of what
they draw on `frontVis` — and that displacement was a fixed step along y, which is correct for a
building facing north and wrong for the other three. A shop lost its doorway, its glazing and its
mullions on three facings out of four, silently, because the shape capture only ever runs at [0,1]
and had no reason to notice. `gl:mesh` now captures every model at **all four facings** and demands
the same face count and the same counts by kind; the extents get a tolerance instead, because
`draw3DBoxAt` applies its yaw in WORLD space, so a yawed box genuinely reaches a hair further on two
facings and failing on that would mean deleting the check that matters to silence one that does not.

The gate also stopped comparing adornment faces against the captured shape. Adornments are
deliberately absent from that shape — it is what the city COLLIDES with, and a downpipe is not
something you can fly into — so holding one against the other would fail every model with a canopy,
and the fix would have been to stop capturing detail.

Two things the port drops on purpose: `emitFlat`'s hairline **stroke** (a 1px outline is not
geometry), and the fade **stagger** noted above. Still on the 2-D side and unchanged: neon, glow,
bloom, painted signage, ground, weather, actors, the HUD — and the arms still RUN, for those lights.

## The quality pass

`npm run models:quality` scores every model out of four, because a pass over 173 buildings cannot be
run on taste: taste works one building at a time and cannot answer *which twenty are worst* or *did
that batch help*. Each property is read off something the renderer already produces, never off a
field an author sets — a metric you satisfy by writing `quality: 5` measures nothing.

| | what it reads | at the start | now |
|---|---|---|---|
| a roof face | the mesh | 172 of 173 | **173** |
| a light at night | a light SPRITE, a gradient or a blur, from `shapeAdornCost` | 159 of 173 | 159 |
| more than one wall palette | the mesh | 146 of 173 | 146 |
| any trim | `flat` faces in the mesh, or a `detail` list | **8 of 173** | **144** |
| all four | | 5 of 173 | **108** |

⚠ **The one model with no roof was `type:bank`, and it had no top at all** — every box in that arm
was drawn `roof: false`, which is right for a face nobody can see and wrong for five of them. A
flight sim looks DOWN at a building, and the Citadel came back as a stone box you could see
straight into from the air. Five are capped now: the two step rings, the entablature, the attic and
the crown. The main mass and the columns keep theirs, because the entablature is wider than both.

⚠ **THE FIRST VERSION OF THE LIGHT METRIC WAS WRONG, AND WRONG IN THE DIRECTION THAT INVENTS WORK.**
It counted gradients and blurs on the stub ctx, which sees a neon blade (it sets `shadowBlur`) and
cannot see a glow at all: `glowPool` blits a bitmap `glowSprite` built ONCE, on its own canvas,
cached per colour for the life of the process. So a building lit only by glows and beacons measured
as completely dark, and the scoreboard reported **109 of 173 emitting nothing after dark** when the
real figure is 14. `shapeAdornCost` now runs with the sprite sink installed and counts what lands
in it. The 14 that are left are mostly things that should be dark — a thorn wall, a dam, a
standpipe, a container yard.

It is a REPORT, not a gate, and deliberately so: a gate here would fail the day somebody adds a
model and go on failing until they finished it, which is the pressure that produces a building
nobody wanted to make. `--fail-under N` is there for the day the pass is done.

### The trim nobody has to author

156 of the 173 models had no trim, and they are spread across **139 distinct arms** — four models
under the biggest one. There is no leverage in hand-authoring that: 139 lists, each written against
one arm's own heights and setbacks, and a number read wrong is a coping band floating in the air
over the building it belongs to.

So it is DERIVED. The captured shape already knows exactly where every roof in the city is —
`shapeForModel` is what the collision, the shadows, the occluder hulls and the cold open all read —
so a coping band taken off it cannot float, whatever arm drew the building. That took trim from 17
models to 143 and "all four" from 8 to 107, for +0.36% of frame cost.

⚠ **It resolves to absolute numbers rather than passing the triples through**, because
`draw3DBoxAt` CLAMPS a half-width to 0.44 — a coping taken from the unclamped `hwRaw` would stand a
foot out from a wide building — and a clamp can only be applied to a resolved number.

⚠ **And the guards have to come before the list is built.** The derived list asks `shapeForModel`,
which CAPTURES: it runs the very same arm again with `SHAPE_SINK` set. Building the list before the
`SHAPE_SINK` test made a capture re-enter itself for as long as the cache was cold — it terminates,
and it draws the right picture, which is why it showed up as a face count and not as a hang. 8,435
mesh faces became 101,400.

Three refusals, each the timid direction: a segment with a YAW is skipped (the band is
axis-aligned and the box is not), a non-square footprint is skipped (a parapet is one half-width
and a rectangle has two), and only the two HIGHEST get one, because coping on every crate in a
yard is not detail, it is noise.

⚠ **Highest — and the first cut took `lodOrder().byIndex.slice(0, 2)` believing it was ranked.** It
is not: `byIndex` is re-sorted into SOURCE order before it is returned, and the bulk ranking
survives only as each entry's `at`. So the slice took the first two segments an arm happens to
draw, which for most arms is the plinth and the ground-floor box — and every building in the city
got a coping band round its ANKLES. It reads exactly as it was reported: the buildings look like
they are coming up out of the ground. A roofline is a height, so the sort is on height.

**Trim is keyed on the ARM, not the record.** A `detail` list is geometry hung on a building, so it
has to know where that building's surfaces are — and what decides that is the arm. `type:office`,
`type:corporate_office` and every named tower drawn by the office arm are the same three setbacks at
the same heights, so one list serves all of them. A record's own `m.detail` still wins. This is what
makes the pass affordable, and it needed the detail layer to stop living inside `drawAuthoredModel`:
a `detail` list is not a property of authored models, it is a property of a model RECORD, and the
172 hand-written arms have records too.

⚠ **Author a wall-mounted part at `[1,0,0]` — the footprint — not at the box's own half-width.**
`draw3DBoxAt` CLAMPS a half-width to 0.44, so a box authored at `fh*1.14` has its wall at 0.44
whenever fh ≥ 0.386 and a part placed at 1.14 floats off the side of the building. At the footprint
it is at worst a few centimetres inside the wall, which nothing can see.

⚠ **And a part stands physically off its face, not merely earlier in the queue.** `lift` moves a
quad in the painter's ORDER, which is all a renderer with no depth buffer can do and is nothing at
all to one that has one: a panel lying in the plane of its wall z-fights into a stipple. `FACE_EPS`
is the real gap.

### What it costs, and the one thing that decides it

Trim is the cheapest canvas work there is — flat fills, no gradient, no blur — and there is a lot of
it. Four arms' worth measured **+3.3%** canvas calls in `framecost`, with `grad` and `blur`
unchanged to the call; all 173 would be several times that. The framerate contract for this whole
expansion was *no regression, measured*, so:

**In 2-D the trim draws at `ADORN_NEAR` only** — inside `detailNear` tiles, where it can actually be
read. That bounds the cost by how many buildings are near you rather than by how many models have
been authored, so the pass can run to all 173 without the frame moving. **In the mesh it is not
gated at all**, because `captureModelMesh` forces that tier: GLASS 2 carries every part at every
distance and a depth buffer draws them for nothing. Trim is a GLASS 2 feature that the 2-D renderer
also shows you when you are standing beside it. The residual +2.3% is one batch of four arms at the
harness's worst case, and the measured frame time does not move (4.9 ms against 5.1 ms on the same
scene, inside the noise).

### Two bugs the pass turned up

⚠ **The GL pass was lighting the city from a fixed north-west fill.** `glLightState` is the
standalone answer the spike needs and it has no sun to ask; used in the game it put every facade
under a key pointing somewhere the 2-D renderer's sun was not, which by day reads as the whole city
being in shadow. The pass now takes `LIGHT_STATE` — the light the arms are shading against this very
frame — and `glLightState` is the fallback.

⚠ **And GL was magnifying the wall textures with LINEAR.** A wall texture is 16×32 stretched over a
whole facade, and GLASS draws it with smoothing on only when the wall is being MINIFIED, so close up
the window rows are crisp blocks of texel. LINEAR magnification turned every near facade into a soft
grey wash — which looked like the lighting being wrong and was the sampler.

### Stage three: the lights

Every light in GLASS is one shape — a **world point**, a radius in **screen pixels**, a colour and
an alpha. A window bloom, a ground glow, an aviation beacon: a disc of light at a place, sized by
how far away that place is. That is a sprite, and a sprite is exactly what a depth buffer settles.

⚠ **Which is the bug the whole plan opened with.** With no depth buffer, hiding a light behind a
wall is done by a PROBE — `decoHidden` against a rasterised occluder field, with a bias, a shrink
and a grow, each a number somebody had to choose. Too generous and the lights come through the
walls; too timid and signage disappears for reasons nobody will trace back to an occlusion change
months later. `gl/sprites.js` makes the question stop being asked: the mass is already in a depth
buffer, so `glowPool`, `drawCityBloom` and `blinkLight` become depth-TESTED quads and a wall in
front of a glow settles it per pixel.

Three things make them the same lights rather than similar ones. **The radius is handed over, never
re-derived** — it is the identical `clamp(k / f, lo, hi)` the painter computes, so the two renderers
cannot drift apart by one of them being retuned; the quad is expanded from a point and that pixel
radius in the vertex shader, so the CPU never has to know which way the camera is facing. **A light
writes no depth**, because it is the appearance of a thing and not a thing — two glows on the same
wall would otherwise cut holes in each other. And **the additive ones are sorted to the end of the
buffer**: a bloom ADDS light to what is behind it and a ground glow lays colour over it, and
painting one as the other is the difference between a lit window and a grey smear.

⚠ **A light sits ON the surface it belongs to**, so at exactly that depth it z-fights into a
stipple. The 2-D renderer has the same problem and solves it by sorting (`DECO_LIFT`); the shader
does it in the only units a depth buffer has, a small nudge in clip z.

Measured on a night cab frame: **9.6 ms → 7.2 ms**, with 2,458 faces and 44 lights on the GPU. A
smaller saving than the daylight case, because what is left on the 2-D canvas at night — neon
blades, marquees, painted signage, the lit-window overlays — is the heavy half. It is also what
makes the rest of the quality pass affordable: **109 of 173 models emit no light after dark**, and
gradients and blurs are the two most expensive things canvas2d does. On the GPU they are quads.

### Two culling holes, closed

⚠ **AN ARCHETYPE IS A BUILDING TOO, and the occluder field had never heard of one.** A tile whose
`building_type` has no model of its own is drawn by the shared biome set — `drawBuilding`, not
`drawTypeModel` — and everything downstream of capture asks `shapeForModel`, which answered null.
The pre-pass duly `continue`d, so an archetype contributed nothing at all: `luxtower` is a
thirty-storey tower, and contacts, lights and the own ship went straight through it. The capture
path now dispatches on the arm, so an archetype is captured through the same primitives, the same
sink and the same affine solve as the 172 models. `shapes:smoke` holds all eleven of them to the
same two gates — it captures at all, and it is affine at a scale the decomposition never saw — and
the archetype list is DERIVED from `BLDG_TYPE_3D` rather than written out beside it, so a new one
cannot be the one that is never checked.

The evidence is in the budget: `framecost` **fell**, 278,336 to 277,545, with eight fewer
`shadowBlur` passes. Those are signs behind archetype buildings that had been drawing through them.

⚠ **AND THE NIGHT CITY GOT ITS LIGHTS BACK PAST NINE TILES.** `lodAdorn` sheds the lights past
`lodNear` because on canvas they are the expensive half — and a cab's `lodNear` is **nine tiles**,
so from a truck at night everything further than that lost its glow and the far end of a lit street
went dark. That trade was about gradients and blits. As a depth-tested quad a glow is six vertices,
so with the sprite sink installed `glowPool` sheds at the tier a blinking beacon does, and the
window bloom's eight-tile cull opens to twenty-two. Both are GL-only: with the flag off the ladder
is exactly what it was, and `framecost` says so to the call.

### The fidelity pass — 1.0%

`__glFidelity()` in the console is the spike's "does it look like the same city" question as a
function, because the first answer to it did not survive as anything re-runnable: **6.8–12.7% mean
colour difference** became a number in a README that nothing could check. It is **1.0%** now, over
eight models × day and night.

⚠ **IT COMPARES ONE BUILDING, ALONE, FROM A FIXED SEAT.** A whole-frame diff of a city measures
COVERAGE, not fidelity: with the flag on GL draws the entire map window while the 2-D pass drops
everything off the side of the canvas or behind a nearer block, and the lights reach twenty-two
tiles instead of eight. Every one of those is an improvement and all of them would land in the
number as error. The mask comes from a third render with no building at all.

⚠ **AND THE CLOCK IS FROZEN, or none of it means anything.** Two renders of the same EMPTY scene
differ by ninety-eight thousand pixels, because the clouds drift, the birds fly and the water moves.
A pixel comparison across a moving sky measures the sky. `framecost` froze the clock for the same
reason and this borrows the trick.

What the pass closed, in order of how much it was worth:

- **The far edge staggers now.** The 2-D fade gives each tile its own moment to dissolve, up to
  three tiles inside the draw limit, so a row does not give up its opacity in unison — a wall of
  haze moving toward you rather than distance. The mesh faded on the unstaggered edge, which put
  the row back in step in the renderer that was meant to be the better one. The jitter is one
  expression (`hazeJitter`) with two readers and rides the vertex as its own attribute.
- **A barrel roof carries the painter's own shade.** It is the one mass primitive that does its own
  lighting — each panel filled with `base` scaled by where it sits on the arc, no texture, no vertex
  ramp — and handing the mesh one flat `base` for the GL light to shade is a different lighting
  model on the same roof. It came out paler and stepped, and it was the worst case in the sweep at
  **3.0%** against 1.2% everywhere else. ⚠ `flat` is a LIGHTING answer, not a kind: a barrel roof is
  MASS that happens to shade itself, and it has to stay mass so `gl:mesh` goes on comparing it
  against the captured shape.

What is left, and it is one thing: **`emitFlat`'s hairline stroke**. A vent and a sign board carry a
1px outline that a triangle cannot cheaply reproduce. It is inside the noise of the number above.

### The floor — 2.3%, and 26x

`__glFloor()` is the fidelity question pointed at the ground, and it is deliberately NOT shaped
like `__glFidelity()`. That one masks a single building out of the frame, because a whole-frame diff
of a city measures coverage rather than shading. The floor IS the whole frame below the horizon, so
here the whole frame is the subject and the two sides are the same renderer with the ground drawn
two ways: GLASS 2 over the 2-D Mode-7 raster, and GLASS 2 over the shader.

Sixteen scenes — city, park, scrub, redrock, open sea, off-map wildlands, a road and a town, each
by day and by night. **Worst 2.30% of pixels differing by more than 24 levels; mean colour
difference 0.10–0.72%.**

`__glFloorCost()` is the other half, and it is why the port was worth doing at all. On a 640×360 cab
frame, ms per frame:

| scene | GLASS 1 | GLASS 2, 2-D floor | GLASS 2, GPU floor |
|---|---|---|---|
| city | 32.9 | 34.4 | **1.3** |
| town | 68.0 | 43.9 | **15.6** |
| open sea | 65.4 | 69.1 | **0.6** |
| road at night | 31.0 | 30.7 | **2.2** |

⚠ **Read the middle column.** Moving the city’s mass, trim, lights and signage to the GPU bought
almost nothing on three of those four scenes, and that is not a disappointment — it is the shape of
the frame. The Mode-7 raster is a fixed per-pixel software loop that costs the same over an empty
desert as over a city, so until it moved it WAS the frame and every other saving was hiding behind
it. Absolute numbers move with the machine; the ratio is the finding.

⚠ **AND FREEZING THE CLOCK IS WHAT MAKES THE FIDELITY RUN MEAN ANYTHING** — for two reasons, not
the one `__glFidelity()` names. The first is the sky: clouds drift, birds fly, water moves. The
second is that `performance.now()` also drives the **dynamic resolution dial** and `PERF_DS`, both of
which are per-CANVAS state that `sceneFor` caches by element id and keeps across a page reload.
Measured on a live clock, two canvases shed resolution at different rates, the comparison silently
starts holding a 576-wide frame against a 640-wide one, and every scene reports a fidelity
regression that is really a scale mismatch. That produced a confident "road scenes are 35% wrong"
finding that was never true. A frozen clock pins `frameMs` at 0, which pins the dial at 1 and
`PERF_DS` at 0.

⚠ **The canvas also needs an explicit CSS size.** Without one its layout size follows its width
ATTRIBUTE, which `paintWindshield` rewrites every frame — so the harness resizes the canvas from
whatever the last frame made it and spirals down instead of measuring.

### The signage — 0.007%, and 481 draws to one

World text is a name across a parapet, a stencilled bay number, a price board on a wall. It was the
last thing GLASS 1 still drew in the world, and it drew each sign as **eight affine strips**, because
a 2-D canvas cannot map a texture through a perspective divide and has to fake it by subdivision. On
the GPU it is one quad through the same `gl/decals.js` the marquees already use, so the artwork is
still painted by the same 2-D code and there is only ever one idea of what a sign looks like. On a
35%-built cab frame the 2-D side goes **481 `drawImage` → 1** (the GL blit), 480 `transform` → 0, 488
`save` → 8, and 50,691 canvas calls → 48,771.

⚠ **No call site grew a world-space twin of the quad it already had.** Every one of them builds a
sign in model coordinates, projects four corners and hands the SCREEN points over — so `makeCam` now
returns `unproj`, the full inverse of `proj`, which is available because every projected point already
carries its own `f`. It answers **null under pitch** (where `sy` carries a height term it does not undo)
and the helper falls back to the 2-D blit rather than putting a sign on the wrong wall.

⚠ **AND THE FAILURE MODE IS SILENCE, WHICH IS WHY `__glSign()` EXISTS.** A sign is paint on a wall,
exactly coplanar with it: a tie in the depth test loses, and the lettering is simply not there. No
error, no warning, no gap in the picture — a building with no name, which looks exactly like a
building that never had one. The 2-D queue could not fail that way, because `DECO_LIFT` sorts an
adornment 0.6 tiles in front of its own host and it drew whatever it was standing behind — and that
lift had been **covering for a real geometry bug** nobody could have seen: The Dry Goods letters its
false front on a plane a tenth of a footprint INSIDE the board. `unproj` takes a `pull` for the
coplanar case (it slides a corner along its own view ray, so the projection does not move and only the
depth does — `FACE_EPS`’s job, done in the one place that knows which ray the point is on); the inset
was fixed at the model, where it was wrong.

Nine lettered models, each alone on empty ground — the two sides being the same renderer with
`RENDER_TUNE.glSign` 0 and 1, so nothing else moves and every pixel of difference IS the lettering.

⚠ **Square on is not enough, and that is where the first draft of this stopped.** Head-on, a sign clears
its own facade or it does not. At a grazing angle the building’s own parapet, cornice and porch cross the
lettering plane, so the inset that matters is the one along the view RAY rather than along the wall
normal — a different number at every heading. The sweep carries head-on at two distances by day and by
night, plus all four entrance facings seen from three tiles off the axis, the same reason `gl:mesh`
captures four facings rather than the canonical one.

**72 cases, 55 of them exactly 0, worst 0.020%** — a few letters trimmed off the end of a board by the
parapet that is genuinely in front of them — against **0.062% with the geometry bug put back**, which is
the only reason to trust the number.
### The frame, and the trap in measuring it — `__glFrame()`

Every other bench here asks whether one thing is faithful, or what one thing costs. This one asks
the question you ask before deciding what to port NEXT — and it exists because that question was
got wrong three times running, each time on an ad-hoc scene, and each time the answer looked
convincing.

⚠ **The scene comes from the whole registry, never from hand-picked names.** A city built from
eight chosen models put the 2-D adornment queue at 1,597 faces a frame, and that number was used to
call the queue the last big thing left to port. Swept properly it is **43** — because one of those
eight was The Meridian Lobby, whose gargoyles alone are **44% of every face all 173 models emit**.
Across the registry the whole queue is 861 faces, mean 5 a model, and **63 models emit none at all**.
Picking the names by hand picks the answer.

⚠ **Pin the resolution dial, or a slow frame measures fast.** The dial sheds resolution exactly
where the frame is expensive, so on a loose dial a storm measured CHEAPER than clear sky and night
cheaper than day — the dial being read as the renderer. The fidelity runs freeze the clock for the
same reason; a timing run cannot, so this pins `resFloor: 1` and `perfDS: 0` by hand.

⚠ **And a call count is not a millisecond.** `drawSkyline` is 492 of the `1,800 canvas calls left
in a frame and looks like the obvious next port; it is two filled 241-point polylines, and timed on
its own over 200 reps its median is **0 ms**. Storm weather is 1,477 calls and does not move the
frame either. The remaining 2-D calls are cheap path construction, which is why the report carries
both numbers and why `calls2d` is the one to compare across days — it is deterministic, and the
clock is not.

⚠ **It reports a SPREAD, and that is the point.** Medians move by two to three times between runs
on one machine. A single number invites a decision it cannot support: the same seat gave the
occluder pre-pass an **8.4 ms cost** and a **6.7 ms saving** in two consecutive runs, which is how
a plan to delete it nearly got made. If the spread straddles what you are trying to measure, the
answer is measure again, not port it.

With the dial pinned, five seats, 640×360:

| seat | window | buildings | ms | bare | the city | calls2d |
|---|---|---|---|---|---|---|
| cab, sparse | 29 | 36 | 2.8 | 1.7 | 1.1 | 1,840 |
| cab, dense | 29 | 118 | 3.6 | 1.7 | 1.9 | 2,017 |
| cab, dense day | 29 | 118 | 3.2 | 1.4 | 1.8 | 1,804 |
| air, sparse | 73 | 105 | 6.5 | 6.7 | `0 | 2,295 |
| air, dense | 73 | 240 | 8.3 | 4.6 | 3.7 | 2,032 |

**The city is now the small half of its own frame**, and what is left on the 2-D canvas is an
overlay: the distant ridge, the sky and cloud layers, weather, the dash, the glass and the badges.
Those should stay there. They have no ordering problem to solve, they do not measure, and the HUD
needs text — moving it means building a glyph atlas to replace something that already works.
### Does a sign light the wall it is bolted to? — `__glLights()`

The mass shader takes the frame's own light list, so a neon sign washes the facade behind it. Two
questions, and they need two different runs.

⚠ **First, did it reach any pixels at all** — because the failure mode here is silence, exactly as
it is for the signage. A uniform location that came back `null` is a legal no-op, a light list that
arrived in the wrong frame falls off the building, and a reach that resolves too small lights
nothing. Every one of those draws the city correctly and looks like the feature being subtle. So the
first half is a pixel diff of one frame with the flag off and on, over a mask of what the buildings
cover, with the clock frozen — a diff across a drifting sky measures the sky.

⚠ **That half found the real bug.** The first cut recovered a world radius from the sprite's SCREEN
radius, through the same projection the sprite quad is expanded by — which is arithmetically right
and answers the wrong question. `r` is `clamp(k / f, lo, hi)`: a clamped screen size, chosen so a
halo looks right on a canvas, carrying almost nothing about how much light the source puts out. It
resolved every sign in the city to about half a tile of reach, and on The Cherry Pit — a building
with two neon signs on its parapet — the feature moved **0 pixels**. Reach comes off BRIGHTNESS now,
which needs no camera at all and cannot go wrong at a device pixel ratio.

⚠ **Second, what it costs**, which is a fill question rather than a geometry one: twelve lights is
twelve distance tests on every wall pixel. ⚠ **And the harness got that wrong first, in the way that
matters.** It ran off, on, off, on and took the median of each side, which for two samples is the
LARGER — so any drift across the sequence landed entirely on whichever side ran last. It reported
the lights costing **2.4–2.6 ms on the DAY seat**, where the night scale means there are no lights at
all and both sides run identical work. A number that big out of a case that is provably free is the
reason to distrust the other two. Alternated three times, taking the minimum of each side, the day
control reads ±0.4 ms and both lit seats read inside it.

⚠ **And a frozen clock cannot settle a scene.** `sceneFor(id)` keeps smoothed per-view state and
advances it by dt, which under a stubbed `performance.now` is zero for ever — so the aeroplane seat
inherited the truck seat that ran before it, and its with-buildings and without-buildings frames came
back IDENTICAL. That reads as `wallPx 0`, which looks exactly like the lights doing nothing rather
than like the harness measuring the wrong camera; it was right on the first call of a fresh page and
wrong on every one after. Each seat takes an id of its own.

At 640×360, with `LIGHT_TUNE` at its shipping row:

| seat | buildings | lights | reach (tiles) | wall px | moved | mean on moved | worst |
|---|---|---|---|---|---|---|---|
| cab, dense night | 118 | 12 of 89 | 2.5–3.3 | 7,947 | 43.0% | 10/255 | 70 |
| cab, dense day | 118 | 0 of 36 | — | 8,993 | 0% | — | 0 |
| air, dense night | 240 | 12 of 127 | 2.2–3.3 | 5,786 | 23.5% | 5.4/255 | 85 |

The run also sweeps `LIGHT_TUNE` — lambert against the shipping wrap, a wider span, a bigger floor,
more gain — so the row that ships is always in the table beside the alternatives rather than being a
number somebody wrote in a comment once and never went back to.

⚠ **Selection and reach are scored on different things, and conflating them cost most of the
effect.** There are twelve uniform slots against a hundred and twenty-odd lights in a dense frame,
so what has to be ranked is how much of the PICTURE each wash covers — reach over distance, weighted
by brightness. Ranking on the sprite's own screen radius instead (which is what the first cut did,
back when reach was derived from it) picks whatever is drawn biggest rather than whatever lights the
most wall: the same frame went from 25.6% of its wall pixels moved to **43%** on the fix, at the same
twelve lights and the same cost.

### Is the cloud deck still the same sky? — `__glClouds()`

The fly-through deck is a swarm of small puffs, each a stack of cards, and every card is a radial
gradient and an ellipse fill. On the GPU each card is a quad, depth-tested against the city the
world pass has just written.

⚠ **The deck had never been run by a test at all, and that is why it was the largest unmeasured
thing in the frame.** `drawVolumetricClouds` returns on its first line without `wxField`, `acX`
and `acY`, and not one harness in this repo passed them — `viewRenderSmoke`, `framecost` and every
bench on this page hand over a map, an hour and a heading and no weather field. `npm run
shapes:clouds` measures it headlessly for the first time at **2,757–9,460 canvas calls a frame**,
median 5,386, against a whole city block's 17,400.

⚠ **The whole frame is compared here, unlike `__glFidelity`**, and that is deliberate rather than
sloppy: the deck covers the sky and the sky is most of the frame, so masking it to "the clouds"
would mean deciding where the clouds are, which is the thing under test. The scene is a bare plain
for the same reason — a city in the frame puts the mass, the trim and the lights into a number
that is supposed to be about vapour.

⚠ **And a third render with NO deck is what makes the first number mean anything.** "The two
renderers agree to 0.15%" is also exactly what comes back when the new one draws nothing and the
old one drew very little — which is not hypothetical, it is what the light pass did one section up
before its reach was fixed. `vsNone` is how much the deck is worth at all, and `meanPct` is only
readable beside it.

At 640×360, on a bare plain:

| seat | cards | calls saved | vs the 2-D deck | vs no deck | worst | ms off | ms on |
|---|---|---|---|---|---|---|---|
| cumulus, from below | 382 | 1,389 | 0.21% | 3.47% | 36 | 1.3 | 0.8 |
| cumulus, in the deck | 244 | 1,200 | 0.10% | 7.74% | 18 | 1.6 | 0.8 |
| overcast, in the deck | 296 | 1,438 | 0.20% | 4.77% | 9 | 2.0 | 1.0 |
| storm, alongside | 543 | 1,595 | 0.09% | 2.86% | 18 | 1.7 | 1.2 |
| overcast at night | 296 | 1,438 | 0.23% | 10.39% | 10 | 2.2 | 1.4 |

`cards` is what the GPU actually drew — a zero there with the flag on is the silent failure, and it
is the reason `glLastFrame()` carries the count. `saved` is deterministic and is the number to
compare across days; the milliseconds are not.

### Two things a bench in this file cannot see

Both cost most of a day in September 2026, chasing three symptoms a player reported — buildings
changing size, roads blinking between light levels, and frame hitches — none of which any gate in
this repo could reproduce.

⚠ **A STATIC CAMERA HIDES EVERY STALE-CACHE BUG.** The GL vertex buffer is uploaded once and
reused, so a bench that paints the same frame forty times is measuring the one condition where a
cache can never be wrong. `windowKey` — the test for whether that buffer still matches the world —
was built from `gx, gy, bt, bn, flr` while the mesh is built from `fh, h, seed, E`, so a tile whose
SEED changed kept its old geometry with no rebuild, then popped at whatever unrelated moment next
changed the key. Twenty-three of the 173 models are seed-variant, which is why it was specific
buildings and not most of them. Every number in this file was measured standing still, and the bug
only exists while you move.

⚠ **AND A HARNESS THAT PINS THE DIAL CANNOT SEE THE DIAL.** Every timing run here sets
`resFloor: 1` and `perfDS: 0`, for the good reason at the top of this section — a loose dial sheds
resolution exactly where the frame is expensive and gets read as the renderer. But it also switches
OFF the thing that turned out to be the second bug: the 0.1 resolution step had no hysteresis, so a
frame time parked near a boundary resized the canvas back and forth about twice a second, and each
re-render at a different sample density read as the road blinking between light levels. Four
separate headless reproductions came back perfectly flat because the harness had the bug disabled.

**The instrument that did find them reads real frames**: `__glChurnStart()` / `__glChurn()` in the
game console (see `client/game/js/panels/gl/world.js`) reports every building that got built more
than one way while you flew. A clean run is `{ changed: 0 }`, and that is what confirmed the first
fix. When a gate renders a scene somebody wrote down, the scene somebody wrote down is never the
one that breaks.

### The two adaptive dials, and the dither neither was allowed to have — `npm run dials`

`paintWindshield` quantises two moving averages every frame: the canvas resolution to 0.1 steps,
and the Mode-7 ground raster's downscale to whole ones. Rounding a moving average is bistable at
every boundary, so a frame time parked near a step changes the quantised answer about twice a
second and re-renders the scene at a different sample density each time. On lane markings and
kerbs that is the road blinking between light levels, which is how it was reported.

The resolution dial had a deadband. **`PERF_DS` never did**, and it has been inert only because
`drawMode7Floor` returns before the raster whenever `glFloor` is on — which means it is armed on
exactly the machines that fall back to the software floor, and nowhere any bench would look. Both
dials now go through one `deadbandStep`, and the quantiser is passed in as a FUNCTION rather than
as a step size: `Math.round(x * 10) / 10` and `Math.round(x / 0.1) * 0.1` disagree at 0.95, which
is a whole level of resolution at the boundary just under native.

⚠ **Every timing harness on this page pins both dials** (`resFloor: 1`, `perfDS: 0`) for the good
reason given under `__glFrame()` — a loose dial sheds resolution where the frame is expensive and
gets read as the renderer. The cost is that a bug driven BY a dial is invisible to all of them at
once; four headless reproductions of the blinking road came back flat because the harness had the
dial disabled. `scripts/shapes/dials.mjs` is the one thing in the repo that runs them LOOSE.

⚠ **And a deadband test passes for the wrong reason if the trace does not dither.** "The step
changed once" is also what a trace that never went near a boundary produces, so every case computes
the NAIVE answer over the same recorded dial values and reports both. At 26.6 ms the resolution
dial changes 9 times over 230 settled frames and 0 with the band; at 28 ms the downscale changes
17 and 0. A 14 → 48 → 14 ms ramp still walks both dials over their whole range and brings them back.

### MSAA, which had never been a decision — `RENDER_TUNE.glMsaa`

`antialias: true` was written into the context attributes once and never swept. The 2-D canvas
GLASS 2 composites onto has no multisampling at all, so this buys smoother building edges nobody
asked for, at a cost paid over the whole backing store and scaling with resolution rather than with
how much city is in frame. Free on the one discrete card everything here was measured on; an
integrated GPU is precisely where a full-frame fill cost stops being free.

⚠ **It is a context CREATION attribute**, so moving it drops the GL view and rebuilds it — the same
path a resize already takes, one visible hitch and then the new setting. That is also why it must
never become an adaptive dial: a knob that flipped this under load would rebuild the context, the
atlas and the vertex buffer twice a second.

### The sun on the depth buffer — parked at 0, and what it cost to find out

`RENDER_TUNE.glShadow` renders the city a second time from where the sun is, into a depth texture,
and compares per fragment in the shader that was going to shade that fragment anyway. It is the
half a painter's queue could never do: `drawBuildingShadow` lays a footprint hull on z = 0 and
that is the ONLY building shadow GLASS has ever had — nothing shades a neighbour's wall, nothing
shades itself, a setback casts nothing onto the storey below it.

**It defaults to 0 because it does not work yet.** What measures correctly:

| | |
|---|---|
| the light matrix | `npm run gl:shadow` — a point and the place its shadow lands on the ground map to the same texel to **2.2e-16**, over 27 daylight hours and 4 window shapes |
| the depth pass | 2048 square, allocated and rendered; `glLastFrame().shadowSize` says so |
| the night gate | **exactly 0** moved pixels with the sun down, and no texture allocated at all |
| the ground | **0.01%** of non-building pixels move, against 2.6% before the sampler changed |

What is wrong is the one thing that makes it a shading value rather than a mask: **the term ignores
its own strength.** Frames at 0.35 and at 1.0 are bit-identical — 0 pixels differ — while
`getUniform` reads 0.35 and 1.0 back out of the live program, and 93% of building pixels are
shadowed at both. A shadow that cannot be turned down is a mask, and a mask over most of the city
is a black city.

⚠ **What has been ruled out, so a next attempt does not re-run it.** Not the depth pass (skipping
the `drawArrays` changes nothing). Not framebuffer state (skipping the whole render changes
nothing). Not the uniforms (matrix and scalars all read back finite and correct). Not degenerate
normals (`captureModelMesh` over every model at all four facings: 105,216 faces, zero non-finite or
zero-length). And not the non-uniform-control-flow bug — that one was **real**: four `texture()`
calls sat behind a per-fragment early return, which is an implicit-LOD sample in divergent flow and
undefined by the spec. It is fixed with `textureLod` and the symptom outlived it.

The hardware compare sampler WAS part of it. Dropping `COMPARE_REF_TO_TEXTURE` for a plain depth
read and an explicit `step` is what took the ground spill from 2.6% to 0.01% — worth knowing before
reaching for `sampler2DShadow` through ANGLE again.

Kept rather than reverted on the same grounds as `glAO`: the knob is provably inert at 0
(`framecost` is unchanged to the call, 292,585), and the rig is the point — `npm run gl:shadow`
headless, `__glShadow()` in the Modelshop for pixels, cost and the night control.

⚠ **Two cheap checks worth taking from the whole episode.** A result that ignores its own strength
is arithmetic, not tuning — stop reaching for the tuning knobs. And a symptom that survives
skipping the pass which produces its input is not about that pass.

### Hardware coverage

`glCapabilities()` in the console answers "will this machine run it", from a throwaway context it
releases immediately. GLASS 2 fails safe at every point it can fail — no WebGL2, a lost context, a
shader that will not compile, a texture page the device cannot hold — but "it turned itself off" is
not a bug report, and this is the difference.

What the pass actually asks for: **8 vertex attributes** (position, normal, colour, uv, wall ramp,
alpha, flat, haze jitter) against a WebGL2 guarantee of 16, and **13 varying components** against a
guarantee of 60. Neither is close.

⚠ **The texture page is the one that can bite.** WebGL2 guarantees only `MAX_TEXTURE_SIZE ≥ 2048`,
and every surface in the city at once — 283 palettes, wall and roof each — wants **2048×4096** at
`texRes: 2`. On a device at the floor that upload is an `INVALID_VALUE` and nothing else: no throw,
no warning, a city wearing a black texture. `buildAtlas` takes the device limit now and refuses a
page that will not fit, which drops the frame to flat palette colours with one warning naming the
limit. A typical frame is nowhere near it — twenty surfaces is a 256×512 page — so the refusal only
ever fires in a pathological view on a floor-spec machine.

The packing got squarer on the way past: a square grid of TALL cells makes a page twice as high as
it is wide, which is the shape most likely to cross a limit on one axis while wasting half the
other. Solving for `cols·cw ≈ rows·ch` costs one square root and brings the `texRes: 1` worst case
to 2048×2048, which fits everywhere.

⚠ **What is still untested is other hardware.** Every measurement in this file was taken on one
machine with a discrete NVIDIA card. The failure paths are correct by construction and the limits
are checked against the standard rather than against this GPU, but "falls back correctly" and
"is fast on an integrated GPU" are different claims and only the first one has been shown. If GLASS
2 ever measures SLOWER somewhere, the first knob to try is `antialias` in `createGLView`: the 2-D
canvas has no MSAA, so the GL path is buying smoother edges nobody asked for at full-frame cost.

### Does it touch the ground? No — 0.02%

`__glTerrain()` answers the question that arrives naturally the first time somebody flies with the
flag on: the picture changed, so everything in the picture falls under suspicion, and "the terrain
looks wrong" is the report. The Mode-7 floor is painted before the blit and never suppressed, so it
should be untouched — and it is, to **0.02% mean over 307,729 ground pixels**, with 0.04% of them
differing by more than 16/255. The buildings in the same frame differ by 3.78%.

The split is the whole value. The building mask comes from a 2-D pair with and without buildings,
and everything outside it is ground; then the same frame is compared flag-off against flag-on and
the two halves are reported separately. *Ground differing* and *buildings differing* are completely
different findings, and a whole-frame number tells them apart not at all.

### What stands on the ground

⚠ **A painter's queue hides things by painting over them**, so the moment GLASS 2 takes the walls
the 2-D queue has nothing to sort a bush, a tree, a lamp post or a pedestrian against. Those are all
screen-space billboards at a tile's ground point, so `groundHidden` probes that point against the
occluder field the frame already built, and a tall building hides what stands behind it.

⚠ **AND THE HOLE THIS SECTION USED TO DESCRIBE DOES NOT EXIST.** It said a wood behind a row of
one-storey warehouses still drew through them, and blamed `OCC_SHRINK` for covering too thin a band
of screen. Both halves were wrong, and both were written from a screenshot rather than a
measurement. Setting the shrink to zero changes nothing — 442 probes, 0 hits either way — because
the field is not what was missing: at that range the trees stand on ground that projects ABOVE the
sheds' rooflines, so they were never occluded to begin with. Held against a building's own
silhouette with the clock frozen, a wood behind it accounts for **nothing**: 1,030 badly-differing
pixels with the trees present, 1,187 with them removed. The difference inside a silhouette is the
ordinary 1% renderer gap, not scatter coming through.

The lesson is the cheap one: a rendering difference you can see in a screenshot is a hypothesis, and
this codebase has a harness for turning those into numbers. Two of them were built this week.

## Forking an arm into something editable

The answer to "can I edit this building?" for the 172 models that are code. The arm itself cannot
be edited — but its captured **mass** can be turned back into an authored document, and then you
can add shapes to it, move them, retexture them and save. **Fork to editable**, on any code arm.

⚠ **A fork is a starting point, not a copy.** Capture is lossy in three ways that all matter:

- **no adornments but masts** — every adornment no-ops under `SHAPE_SINK` by design;
- **no per-box texture seed** — the walls will be jittered differently;
- **one entrance facing**, frozen at capture. This is the finding that ended the port of the city:
  79 arms that were byte-identical at the capture conditions all broke when the facing changed.

**It keeps the arm's key and stands in for it.** The first cut gave the fork its own id and bound
it to a name nothing carried, which was safe and useless — you edited a model no tile resolved to,
while the building in the game went on drawing the arm. So the fork claims the key and the arm is
kept in `LEGACY_MODELS`, exactly as a port's is: **`RENDER_TUNE.legacyArms` puts the whole city
back on the hand-written arms with one flag.**

It writes `replaces`, not `portedFrom`, and the difference is the whole point. `portedFrom` claims
*this draws the same building as the arm*, and `scripts/shapes/modeldiff.mjs` re-measures that on
every push. A fork does not draw the same building — capture drops the adornments and a facing — so
claiming it would be claiming something false and the port gate would rightly fail the push.
`replaces` says *this is deliberately a different building, drawn instead of the arm*; it is not
diffed, and `shapes:smoke` names every stand-in on every push so an override is never a surprise.

Of the 172 arms, 138 can be expressed at all; the other 34 hold entrance-face-only mass and the
fork refuses them by name rather than producing a wrong building. The inversion is
[client/shared/model-port.js](../../client/shared/model-port.js), shared with
`scripts/shapes/autoport.mjs` so the tool and the build cannot disagree about what a port is.

## The four mass kinds

`box`, `drum`, `barrel` and `sawtooth` — every mass primitive the renderer has.

⚠ A barrel's `archH` defaults to the **footprint** basis, not the height one. Its rise is
proportional to its span; tagging it `h` would make a wide shed grow a taller arch when
somebody adds a storey.

⚠ A barrel's `base` is a real authored colour, not one derived from `pal`. It is the one
colour the LOD renderer cannot work out from a palette key — the capture records it for
exactly that reason — so deriving it would quietly repaint every roof.

A barrel's and a sawtooth's **top is derived** (`z0` plus the rise) rather than authored,
which keeps bounds, framing, LOD ranking and the cage uniform across all four kinds instead
of two of them being special cases everywhere.

Adding them moved the port survey: **138 of 172 arms are now expressible**, up from 129, and
the only remaining reason an arm cannot be expressed is entrance-face-only mass.

## The four detail kinds that make a wall a wall

The detail vocabulary started as twelve kinds that are all **bolted to** a wall — a pipe, a vent,
an AC box, a cable, a board. Hang forty of them on a flat box and you still have a flat box: none
of them changes the silhouette, and none of them gives the facade any depth. Four kinds do, and
they are the ones to reach for when a model looks like a boxy excuse for a building:

| kind | what it is | the part it is not |
|---|---|---|
| `windowBay` | surround, glazing, shadowed head, lit sill, optional bars and transom | not a painted rectangle |
| `canopy` | a slab cantilevered over the storey below, authored soffit colour, optional strip light | not `balcony`, whose underside comes off the wall palette |
| `signGantry` | a billboard standing on its own legs | not `signBoard`, which is flat on a wall |
| `bladePanel` | a sign slab hung proud, with a visible edge return | not `neonBlade` — see below |

⚠ **`depth` on a `windowBay` is how far the frame STANDS PROUD, never how far the glass is set
back.** A recess is not drawable here at any price: nothing can cut a hole in a wall, so glazing
behind the wall plane is behind a solid quad. On the 2-D painter it sorts behind the *whole* wall
(mean depth, measured at the wall's centre) so it survives only on the camera-facing half of the
facade; on GLASS 2 the depth buffer occludes it correctly and it is gone from every angle. A
surround standing proud reads as the same thing — at an oblique view you see the inside of the far
jamb, which is the cue a reveal actually gives — and is true in both renderers. Measured while
getting this wrong: six of ten windows invisible, and which six changed as the camera swung.

⚠ **A part bolted to a wall needs a `lift`, and projecting outward is not protection.** Same
mean-depth sort: a slab attached near the far end of a long facade sorts behind the whole facade.
`lift` biases the painter only — the mesh is pushed before it — so it costs GLASS 2 nothing.

⚠ **Prefer `bladePanel` over `neonBlade` for anything hung on a building.** `neonBlade`'s
half-width is in SCREEN PIXELS (clamped 2–9), so it keeps a constant thickness however you move,
never foreshortens, and reads as a sticker floating in front of the wall. It is also cheaper to
replace than to keep: it sets `shadowBlur`, and swapping Voltage's two blades for two panels made
the whole 16-frame `framecost` baseline **1.5% cheaper**.

### The bug under all the blades

`neonBlade` painted its label **mirrored, unconditionally** — every blade, every heading, every
distance. The quad it hands `drawSurfaceText` is built from a screen-space perpendicular
`nx = -uy/len * wpx`; a blade is upright, so `uy` is always negative and `nx` therefore always
positive, and the corner passed as *top-left* was always the one on the right. `_bladeSign`
defaults a blade's label to the building's own name, so this was most of the lettering in
Coldwater, reversed. It survived because the no-label fallback rungs are symmetrical, and because
a mirrored word at a hundred metres still reads as a word — it is legible from a truck cab, which
is where it was finally reported.

`signBoard` had the sibling of it: `color` filled the board **and** was handed over as the ink, and
`solid` lettering is deliberately flat with no white core and no halo, so a labelled board painted
its own words in its own colour and read as a blank rectangle. `ink` is now its own field and
defaults to whichever of dark/bone can actually be read against the board.

## Authoring versus the derived kit

`RENDER_TUNE.derivedKit` generates windows, a riser, roof plant and a ground floor for the **127
models nobody has hand-authored trim for**, off each building's own captured shape. Read the section
in [building-shapes.md](../../docs/reference/building-shapes.md) before changing it — particularly
why the style axis is the palette rather than the archetype, and why the three wall arms are out.

**It raises the floor; it does not reach the ceiling.** The kit is one rule applied to 127 buildings
sight-unseen, so it is deliberately conservative: it will never place the thing that makes a
particular building *that* building. Voltage is the counter-example and the reason this tool exists
— a deliberate five-mass composition with its signage on real structure, which no derivation would
have produced. The honest division of labour is that the kit stops anything reading as a bare box,
and authoring in the Modelshop is how a building becomes worth looking at.

⚠ **A model with an `ARM_DETAIL` entry or an authored `detail` list never sees the kit** — those 46
keep their own trim, which is the intended precedence and also the reason a spot-check of
`type:office`/`type:power`/`type:warehouse` shows no change at all. Pick a subject off the derived
list before concluding the kit does nothing.

## Textures

In GLASS the **palette key IS the surface**: `draw3DBoxAt` takes one surface argument and
`wallTexMixed` derives both the colour and the material generator from it. (The `seed` beside
it does not reach the texture at all.) So there is no separate texture layer to expose —
choosing a palette is choosing a surface.

Click a swatch, on the model or on any segment, and the picker opens: **283 keys grouped by
their material** — brick, glass, corrugated metal, art-deco limestone, and thirteen more. The
grouping and the swatches come from `wallPaletteInfo()`, so the tool holds no second copy of
those sets. A key that is not in the table turns amber rather than silently rendering grey.

## Where a model appears

`bind` decides whether a model is ever seen, and it was the last field you had to hand-edit.
It is also the easiest thing in the format to get wrong, so it is now a picker over the real
targets with their real tile counts — served from `content/zones` — and it says out loud when
a binding reaches nothing:

- *"3 tiles would draw this model"*
- *"reaches nothing — all 3 of its tiles are named, and a name beats a type"*
- *"reaches nothing — a hand-written luxtower arm already claims this name"*
- *"reaches nothing — no building in the world carries this name"*

That first warning is the worked example describing its own defect. **Bind by NAME**: 408 of
the 416 building tiles carry one, and a name beats a type.

⚠ `portedFrom` and `pixdiff` are deliberately NOT editable here. They are a claim that a
model was measured against the arm it replaced, and `autoport` writes them after measuring.
A text box would let somebody assert a port that never happened.

## Saving, exporting, importing

**Save** writes the file and rewrites the bake. **Export** downloads the model as JSON.
**Import** replaces the open model from a `.json` file — validated with the same
`validateModel()` the server and the bake run, before it lands, so a file from anywhere else
cannot put the editor into a state the build would reject. An import is one undo step.

## Undo

Whole-document snapshots rather than per-operation inverses: a model is a few kilobytes, the
operations are varied, and sixteen hand-written inverses are sixteen chances to be subtly wrong.

⚠ **The snapshot pushed is the state BEFORE the edit.** A form field mutates the document and
then calls back, so snapshotting at that moment captures the very change you are undoing — which
makes Ctrl+Z restore what you already have and look broken. A per-file baseline holds the state
as of the last entry; a push stores that and then advances it.

A drag is **one** step, not sixty: pushes coalesce by kind within a short window.

## Buildings and vehicles

The browser groups by family, and the first signal is the codebase's own: the arms are already
namespaced by the place that owns them (`asc_`, `trm_`, `sw_`, `dw_`), which sorts 52 models
for free. A prefix earns a group by having members, so a new region groups itself.

**A vehicle is edited as parameters, never as mass.** An aircraft or a truck is a face list from
`aircraftFaces` painted by `drawAircraftModel` — a second renderer, wired up here as
`renderVehiclePreview`. There is no capture for it and no geometry to author, but the mesh is
*generated* from a row of plain numbers, so the row is what the tool edits.

Nine of the fourteen subjects have one: five fixed-wing classes (`prop`, `gunship`, `heavy`,
`locust`, `divebomber`) and the four trucks. The rest — the Mayfly, the Cub, both helicopters
and the wreck — are meshes somebody drew rather than proportions somebody set, and the panel says
so instead of showing an empty form. **They must never be given a row**: a file that changes
nothing is worse than no file.

Rows live in `content/vehicle_models/<kind>_<id>.json` and are baked by `npm run vehicles:bake`
into `client/shared/vehicle-models.js`, which is what aircraft3d.js imports. Same shape as the
building models and for the same reasons — the renderer runs in a browser, there is no build step,
and a mesh is built on the hot path.

Three things worth knowing before you touch it:

- ⚠ **A change busts the mesh cache, and has to.** `aircraftFaces` memoises on
  cls+detail+armed+variant and nothing in that key says which parameters built it, so without the
  flush the first build of a class wins for the session and every slider after it does nothing.
- ⚠ **A fixed-wing file is the RESOLVED row, not a patch over `FW_DEFAULT`.** The code table
  spread the defaults into each class; a file that did the same could not tell you a Warthog's
  span, only that it differs. `FW_DEFAULT` stays in aircraft3d.js as the starting point for a new
  class and the fallback for a class with no row.
- ⚠ **The schema can only say a value is JSON.** A string where a number belongs is legal JSON and
  reaches the mesh builder as `NaN`, which paints nothing and throws nothing — the same failure
  the adornments had. So `shapes:smoke` builds every authored vehicle and fails on one non-finite
  vertex.

The move from code tables to content changed no geometry: all fourteen meshes are byte-identical
to the ones that shipped before it, which is the check to re-run if this is ever refactored again.

⚠ **`fh` and `h` are derived, never set.** They were two sliders, which meant the preview could
show a footprint and a storey stack the game never produces. `buildingScaleFor()` in windshield.js
is the sim's own formula — `BUILDING_FOOT` plus the per-tile jitter, and floors x `FLOOR_Z` — and
the tool asks it. **Floors** is the control, because floors is what the world actually authors.

## What it is

The editor for **GLASS** building models. GLASS — Geometry, Lights, Aircraft, Streets &
Structures — is the renderer in
[client/game/js/panels/windshield.js](../../client/game/js/panels/windshield.js): CPU only,
a plain 2D canvas, no WebGL, faces queued and flushed back-to-front because there is no
depth buffer. Every building in the flight sim and the truck cab is one of its ~172 model
arms, and until this tool the only way to look at one was to fly to it.

## The one rule

**It imports the real renderer.** Every picture on the page comes out of
`renderModelPreview()`, a named entry into the same `drawTypeModel` the sim calls — the
same seam as `shapeRenderSmoke` and `viewRenderSmoke`. There is no preview renderer here
to disagree with the game about wall texture, night lighting, face order or glow. That is
the property the tool is worth anything for, and it is why the server is little more than
a static file server: it owns no geometry, no palette and no camera.

It draws no terrain, no sky pass, no traffic and no weather. One model on a flat ground
plane, so the thing you are looking at is the thing you are editing.

### ⚠ The one place it is now the OTHER renderer

The rule above was written when GLASS 1 was the renderer. The viewport is still GLASS 1 —
`renderModelPreview()` draws to a 2-D canvas — and since 2026-09-09 the game defaults to
GLASS 2. Everything about the model is still shared, which is what the rule is for; but
one thing is not, and it is visible.

**A 2-D canvas cannot map a texture through a perspective divide.** `drawTexQuadPersp`
fakes it by cutting a face into cells small enough that affine is right within one, and
the shipped budget stops at six pixels of residual warp — measured as the cost-neutral
point for a renderer drawing a whole skyline. Standing at the foot of a tower, six pixels
is a window grid that visibly bows and steps. On the GPU the divide is per pixel and free,
so **the game does not have this and the preview did**: an author looking at a facade from
the pavement was the only person in the project who could see it.

So `renderModelPreview` takes its own budget — `PREVIEW_TEXQ`, 1.5px capped at K96 — while
`RENDER_TUNE.texqPx` / `.texqMaxK` / `.texqCells` keep the shipped defaults for the
fallback path. Measured over five models at 790×870: free at the distances the tool
actually orbits at (1.78 ms/model against 2.42 shipped), 8.1 ms against 3.0 nose-on, and
the displaced-pixel count against a converged reference roughly halved — office 3.8% →
2.4%, civic 4.7% → 2.4%, bank 9.2% → 4.7%, and exactly 0 → 0 at orbit distance, where
there was nothing to fix.

⚠ **Do not "improve" it by raising K further.** Past about K96 the picture gets worse, and
it looks like it is getting better until you measure it — every cell is a clipped,
antialiased blit, and once a cell is a pixel wide its two seams are most of it. On the bank:
0.4px/K400 scores 5.5% and 0.2px/K800 scores 9.2%, as far from the truth as doing nothing
was, with mean luminance climbing 27.41 → 27.95 as background bleeds through the seams. A
reference render taken at an enormous K is therefore not a reference — the first cut of
this measurement used one, and it scored the fix as worse than the bug.

**The honest check is still the GL toggle.** Press it: the mass comes back
perspective-correct because a GPU is drawing it, which is what the player gets.

## What it shows

- Every model from `shapeModelRegistry()`, named and by `building_type`.
- **Cockpit and Cab presets.** The cab one matters: `ADORN_NEAR` detail exists for a driver
  at eye height 0 and a cockpit almost never sees it, so authoring only from a cockpit is
  exactly how near-tier detail ships broken.
- Orbit, distance, eye height, floors, seed, night, entrance facing, and the shape cage.
- **Framing is derived from the model**, not set by hand — a shopfront and a 2.9× tower
  cannot share one camera, and an author should not spend the session dragging sliders.
- **At other scales** — the model at the three scales the affine decomposition is solved
  from plus the one it is verified against. This is what "affine in `fh` and `h`" looks
  like, and it catches a scaling mistake before the bake warns about it.
- **The cage the cold open gets** — `shapeWireList(m, 9)`, which today is only discoverable
  by running `shapes:bake` and reading a diff. If the gap-filling rule left your tower
  headless, you see it here.
- Constant-term warnings, seed variance, affine error, and adornment cost in gradients and
  blurs — the last is what stops a model that costs 40 gradients reaching a skyline.

## Orbit is heading, and pitch is eye height

**The heading is the azimuth and the pitch is real.** GLASS grew a pitch term (below), so the
orbit is a proper one: middle-drag left and right goes round, up and down goes over the roof and
under the belly, and the camera is *aimed* at the subject rather than the picture being slid back
into frame beneath it.

⚠ **A vertical drag moves on a SPHERE, never up a line.** Raising the eye while holding the
distance is a crane: the camera climbs and the subject stays as far away in plan, so it flattens
and slides instead of turning under you. The orbit holds the *radius* about the subject's own
mid-height, and `aimAtModel()` solves the pitch that points at it — `panY` stays 0.

What that replaced is worth knowing, because it explains the shape of the older code. With a fixed
horizontal optical axis the only way to look down was to raise the eye and then shift the horizon
by hand, so the viewport carried two workarounds: a ceiling on the arc (a high eye *sheared* the
model instead of turning it) and a floor under the camera distance (which read as the camera being
inside a long rig). Both are gone. The only limits left are that the arc stops a degree short of
the poles — at the pole every heading projects the same picture, so dragging through it flips the
model end for end — and a numerical floor under the depth distance.

⚠ **The eye may go below the ground**, which is right for a model viewer and is the one place this
camera is deliberately not the sim's: in the game the floor under the eye height is what stops the
terrain collapsing.

## Spin

The turntable, and two rules it learned the hard way. **The heading comes from the clock**, not
from a per-frame counter — otherwise the speed is whatever frame rate the model happens to render
at, and a shopfront spins several times faster than Halcyon. And **it does not ride
`requestAnimationFrame` alone**: rAF stops being delivered whenever the page is not being
composited (a background tab, an occluded window), and the spin then stops dead with the button
still lit, which is indistinguishable from it being broken. A timer runs beside it and whichever
arrives first advances the frame.



There is no pitch term in this projection at all: `proj` puts a point at
`horizonY + depth · (EH − wz) / f`. Tipping the view down **is** raising the eye, and that
is true of the cockpit and the cab as much as it is here. A preview with its own pitch
matrix would be showing you a camera the game does not have. So the model is parked `dist`
tiles straight ahead and orbiting walks the heading around it.

## Why its own server, beside the Studio rather than inside it

Same argument [scripts/dev.mjs](../../scripts/dev.mjs) makes about the Studio: no database
in the process, validation on the request path, nothing that could stall the game server's
tick loop. Separate from the Studio because the Studio's client is a top-down 2-D tile
editor with zero imports and this one must `import` windshield.js as a module — a different
serving story and a different module graph.

The one route the Studio does not have is a static passthrough for `client/**`, because the
browser resolves windshield's own relative imports itself. It is an **allowlist of
directories**, not a root, so `content/`, `server/`, `plugins/` and the git tree are
unreachable by construction rather than by a filter somebody has to remember to update.

## Phases

1. **The inspector** — built. Look at any model, at any scale, from either seat.
2. **Authored models, read path** — built. See below.
3. **The differ** — built. See below.
4. **The editor** — built. See below.
5. **The port** — attempted, measured, and **not done**. See below.

## The port: why it does not happen (phase 5)

```bash
npm run models:survey     # the measurement below, re-run from the live registry
```

[scripts/shapes/autoport.mjs](../../scripts/shapes/autoport.mjs) generates an authored model
from an arm's own capture — no human re-measures anything, the affine triples are just read
back out as plain numbers. It works. What it produces is then measured against the arm it came
from, and that is where the port stops:

```
172 hand-written arms
  129 can be EXPRESSED as authored boxes and drums
   43 cannot: 30 entrance-face-only mass, 12 barrel roofs, 1 sawtooth

  of the 129, at the CAPTURE conditions the port is:
     79  byte-identical to the arm
     50  already different (drum shading and per-box texture seeds are not captured)

  and of those 79 exact ones, how many stop matching when you change:
      0  the footprint or storey height   <- the affine basis holds perfectly
     10  the tile seed                    <- capture freezes ONE seed
     79  the entrance facing              <- capture freezes ONE facing
     69  adornments back on               <- capture drops every one

  0 arms port faithfully.
```

**The blocker is facing, and it is every single one.** Capture runs the arm once, at the
canonical entrance `E = [0,1]`, and an authored model reproduces that shape rotated. The control
experiment settles what that means: the **arms differ from the shipping `drawModelLOD` renderer
in all 258 cases tested** at non-canonical facings — so an arm is *not* a pure rotation of its own
capture. The LOD lives with that because it only takes over at distance and is explicitly an
approximation. A port replaces the arm at *every* distance, including from the truck cab at arm's
length, so the same approximation is not acceptable.

Three things would have to change before a port is worth attempting again, and each is real
design rather than effort:

1. **Capture would have to record all four facings** (or the schema would need facing-conditional
   geometry), because 79 of 79 otherwise-exact ports fail on this alone.
2. **Adornments would have to survive capture** — they no-op under `SHAPE_SINK` by design, and 69
   of 79 arms lose something visible. Recovering them means reading the arm's source, which is the
   hand-port of 145 arms this whole design existed to avoid.
3. **Per-box texture seeds and drum style functions would have to be recorded**, which is what the
   50 "already different at capture" arms are.

Two things this exercise did establish, both worth keeping:

- **The affine basis is exactly right.** Zero of the 79 exact ports break when the footprint or the
  storey height changes. The hardest-looking part of the format is the part that works.
- **The differ earned its keep.** Without it, 129 auto-generated models would have looked
  plausible in the tool and shipped as quietly downgraded buildings. It refused all of them, and
  named the axis.

The arms stay as code. That is the outcome, not a shortfall — and it is now a measurement anybody
can re-run in a second rather than an opinion.

## Editing (phase 4)

Pick an authored model and the right-hand rail becomes a form: every segment and adornment as
a card, with add, duplicate, reorder and remove, and a **New** box that creates a model and its
file in one go. Click a piece in the 3-D view to select its card; drag it to move it on the
ground. Save writes the file and rewrites the bake.

**The form is generated from the schema, never written per field.** A field added to
`SEG_SCHEMA` is editable immediately, and one that is not in the schema cannot be typed in by
accident — the property the Studio gets from the tag catalog, for the same reason.

Three things worth knowing.

**The preview is live because the editor compiles in the browser** — with `compileModel()` from
[client/shared/building-model-schema.js](../../client/shared/building-model-schema.js), the same
function `models:bake` runs. That module sits in `client/shared` precisely because three
processes read it (the bake, `shapes:smoke`, and this editor), which is the same reason
`tagCatalog.js` lives there. A second compile in the tool is how an editor starts drawing
something the build will not.

⚠ **Every edit makes a NEW record rather than patching one.** `shapeForModel` caches captured
geometry in a WeakMap keyed on object identity, so mutating in place would leave the cage, the
bake preview, the roof readout and the scale strip all showing the shape from before your edit —
which looks exactly like the edit not working.

⚠ **A save that the build would reject is rolled back.** Validation runs before the write, but a
**bind collision is a property of the collection** and invisible to a single document — so the
file is written, the directory is re-baked, and if the bake fails the write is undone and the
answer says `rolledBack`. Leaving the file and refusing the bake reads as the honest state and
is not: it leaves the repo broken by a tool whose whole promise is that it cannot author
something the push gate rejects.

**Drag moves on the ground plane only.** Size, height and yaw stay in the numeric fields
deliberately — a perspective view with no depth cue makes those a guess, and the fields are
exact. The drag is for roughing out where a piece sits; the numbers are the truth, which is why
they update as you drag.

**Saving does not update the running game.** The renderer imports the baked module at load, so
the sim shows your change after a client reload. The Modelshop preview is live regardless.

## Authoring a model (phase 2)

One JSON file per model under `content/building_models/`, then:

```bash
npm run models:bake     # → client/shared/building-models.js, which the renderer imports
```

[content/building_models/foundry.json](../../content/building_models/foundry.json) is the
worked example. The schema, and the reasoning behind each rule, is
[client/shared/building-model-schema.js](../../client/shared/building-model-schema.js).

An author writes plain numbers in tile units at a fixed basis (`fh` 0.4, `h` 1 — the pair
the capture itself solves at) and tags each field with what it scales against; the affine
`[a·fh + b·h + c]` triple is derived by the bake. Field names are the drawing primitive's
own argument names, so the file reads against `draw3DBoxAt` and `drawFacetDrum` with no
translation. **Boxes and drums only** for now — barrel roofs and sawtooth monitors take a
local frame and three authored colour arrays respectively, and neither blocks authoring a
building.

**It plugs in at `modelFor`, which is why nothing else changed.** An authored model is an
ordinary model record whose `type` is `'authored'`, and `drawAuthoredModel` draws it
through the *real* primitives — so `SHAPE_SINK` captures it exactly as it captures a code
arm, and CFIT collision, the truck obstruction probe, ground shadows, occlusion hulls, the
distance LOD and the cold open's skyline all read it with no change of their own. The
foundry appeared in the cold open's bake the moment it existed, and nobody wired that up.

### ⚠ Bind by NAME. A type bind draws on almost nothing.

`modelFor` prefers a building's **name** over its **type**, and **408 of the 416 building tiles
in Coldwater carry a name**. So `{ by: 'type', … }` only reaches the eight nameless ones — and in
practice not even those, because their types already have arms.

The worked example demonstrates this by being caught by it: `foundry.json` binds to
`type:foundry`, whose three tiles are all named (*The Forge*, *The Foundry* ×2) and all have
hand-written arms of their own, so **it is not reached by any tile today**. Every other gate here
reported it as perfectly healthy. `shapes:smoke` now prints the unreached binding on every push:

```
0/1 authored binding(s) are reached by at least one tile
  — NOT reached: type:foundry (a name on the tile beats a type bind)
```

It is a warning rather than an error, because authoring a model before placing its tiles is a
reasonable order to work in. And there is a real conclusion behind it: **no building in Coldwater
today would be improved by an authored model** without overriding a hand-made arm, which is the
same thing the port measurement says from the other direction. The authored format is for
buildings that do not exist yet.

⚠ **A hand-written arm always wins.** The registry merge is `??=`: a file cannot silently
replace one of the 145 code arms. `shapes:smoke` reports a shadowed binding rather than
letting it be inert and mysterious.

## Does it draw the same picture? (phase 3)

Porting a hand-written arm to data is only safe if you can show the replacement draws what the
arm drew, and 145 arms cannot be reviewed by eye 145 times.

```bash
npm run models:diff -- type:foundry named:thefoundry   # compare any two
npm run models:diff -- --ported                        # every ported model vs its arm
npm run models:diff -- --determinism                   # every model, rendered twice
```

⚠ **It is not a pixel diff, and it is not named one.** A pixel comparison in node needs a native
canvas dependency and a build toolchain in CI, for a codebase whose premise is no build step. So
[scripts/shapes/modeldiff.mjs](../../scripts/shapes/modeldiff.mjs) compares **drawing operations**
instead: the model is rendered against a recording context (`captureModelTrace`) and the two
recordings are compared, across 48 cameras — day and night, four facings, three scales, two seeds.
Dependency-free, exact rather than thresholded, and sensitive to things a small pixel diff misses.

The cost, stated once: **it over-reports.** Two paths drawn in a different order make the same
picture and a different trace. That is the safe direction for a gate — a false alarm costs a look,
a false pass ships a worse building — but a non-zero distance is a *question*, not a verdict.

**The Difference panel answers the question, in real pixels.** A browser has a real canvas, so it
renders both models at the camera you are currently looking through, subtracts them, and shows the
difference amplified ×6 (an unamplified delta of four or five levels is invisible on a dark
building, and that is exactly the size of mistake a port makes). All 173 models compare against
themselves at 0.000%, which is what makes a non-zero reading mean something.

### Porting an arm

Add `portedFrom` to the authored file, naming the arm's `case` label. That claim changes the merge
rule — the authored model now **overrides** the arm rather than deferring to it — and

- the arm is kept, in `LEGACY_MODELS`, so `models:diff --ported` re-checks the claim on every push
  for as long as the arm exists, rather than once when somebody made it;
- `RENDER_TUNE.legacyArms = 1` puts every ported building back on its hand-written arm, so a bad
  port is one flag in prod rather than a revert of the file everything else is also editing. It
  reaches CFIT collision too, not just the picture;
- `pixdiff` records the tolerance that was accepted, so a later regression is a diff on a number.

**Delete the arm in a later commit, deliberately, once the port has flown.**

## Verification

`npm run client:smoke` parses this client (⚠ the backtick-in-a-template-literal rule bites
hardest in form-building code). `npm run shapes:smoke` covers the models themselves and owns
seven gates on the authored half: schema errors, a stale `models:bake`, a binding shadowed by a
code arm, the two adornment lists agreeing, every adornment reaching the camera at a **finite**
position, every model rendering **identically twice**, and every `portedFrom` claim still holding.

Determinism is the precondition for all of it — a model that draws differently on a second
identical render cannot be diffed, so a port could never be proved. It is worth having on its own
too: a `Math.random` or a real-clock read in an arm would make that building different every frame
and nothing else here would notice, because the capture harness holds `now` fixed and never runs
one model twice at the same camera.

That last one exists because of the bug it was written for. The dispatch table read the world
position off the wrong object, so every adornment projected at `NaN`. Nothing threw: the
guards in those helpers are all `if (p.f <= 0.1) return`, and `NaN <= 0.1` is false, so each
sailed past its own bailout and painted at NaN coordinates — which a canvas draws as nothing
at all, with no error. The model rendered perfectly with its neon, beacons and mast silently
missing, and it had already reached the committed skyline bake that way.
