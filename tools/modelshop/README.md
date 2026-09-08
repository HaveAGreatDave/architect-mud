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
