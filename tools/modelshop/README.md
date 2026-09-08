# The Modelshop

**STATUS: BUILT — an inspector, an authored model format, a differ, and an editor with a
3-D viewport (orbit/pan/zoom, move/scale/rotate, keyboard). Buildings are editable; vehicles
are shown read-only. Phase 5, the port of the hand-written arms, was attempted, measured and
abandoned on the evidence — the tooling for it ships, the ports do not.**

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
| drag empty space | orbit — horizontal turns, vertical arcs the eye |
| middle- or right-drag | pan |
| wheel | zoom |
| click a piece | select it, and its card in the rail |
| drag a piece | apply the active transform to it |
| <kbd>G</kbd> <kbd>S</kbd> <kbd>R</kbd> | move / scale / rotate |
| <kbd>Shift</kbd>+drag | the vertical of whatever transform is active |
| <kbd>D</kbd> / <kbd>Del</kbd> / <kbd>Esc</kbd> | duplicate / remove / deselect |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | undo / redo |
| <kbd>O</kbd> | the model browser · <kbd>F</kbd> re-frame |

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
the cockpit and the cab have. Scale and rotate are horizontal drags with Shift for height;
height can never be a free drag because there is no depth cue to judge it against.

## Textures

In GLASS the **palette key IS the surface**: `draw3DBoxAt` takes one surface argument and
`wallTexMixed` derives both the colour and the material generator from it. (The `seed` beside
it does not reach the texture at all.) So there is no separate texture layer to expose —
choosing a palette is choosing a surface.

Click a swatch, on the model or on any segment, and the picker opens: **283 keys grouped by
their material** — brick, glass, corrugated metal, art-deco limestone, and thirteen more. The
grouping and the swatches come from `wallPaletteInfo()`, so the tool holds no second copy of
those sets. A key that is not in the table turns amber rather than silently rendering grey.

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

**Vehicles are in the tool but read-only.** An aircraft or a truck is a face list from
`aircraftFaces` painted by `drawAircraftModel` — a second renderer, wired up here as
`renderVehiclePreview`. They cannot be edited because their meshes are parametric code in
aircraft3d.js with no capture and no authored format: there is nothing for an editor to write.
Showing them is still worth it, since until now the only way to look at an airframe was to fly it.

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
