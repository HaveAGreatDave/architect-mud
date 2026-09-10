# Building Shapes — the flight sim's geometry, as data (as built)

**STATUS: BUILT.** Capture, distance LOD, occlusion culling, ground shadows, per-point
collision, the cold open's skyline, and the `shapes:smoke` / `shapes:bake` scripts all ship.
Remaining ideas are listed at the bottom and are marked as such.

A building's shape used to exist **only as code**: 72 imperative `case` arms inside
`drawTypeModel` ([client/game/js/panels/windshield.js](../../client/game/js/panels/windshield.js))
painting setback tiers, twisted shafts, domes and barrel roofs straight into the flight camera.
Nothing else could read a building's form, and three things were quietly wrong because of it:

- **Collision was a lie.** It tested one axis-aligned square with its roof at `floors × 12 ft`. The
  per-model height multipliers — office `1.7×`, Halcyon `2.9×`, Solenne `3.31×` — never reached the
  sim, so you flew through the top two thirds of the tallest towers in the city.
- **Shadows were a lie.** Every building cast the same rectangle.
- **The cold open couldn't show the real city.** It drew one wireframe box per tile, because it
  cannot import the ~8500-line renderer on a first login.

This doc is the map of what replaced that. **Read it before touching a building model, the CFIT
sweep, or the cold open's flythrough.**


## The camera can tilt now (the pitch term)

`makeCam` in windshield.js takes an optional `pitch`, in radians, positive tipping the view down.
Until it existed the optical axis was horizontal *always* — `sy = horizonY + depth·(EH − wz)/f` is
a pinhole that cannot tilt — so raising the eye was the only way to look down and a plan view was
not expressible at all. It is one rotation about the lateral axis, applied in view space before the
divide.

⚠ **The unpitched path is a separate closure, not θ = 0 through the pitched one.** `cos 0` is
exactly 1 and `sin 0` exactly 0, so the pitched form reduces algebraically — but `f·1 + u·0` is
not the same floating-point expression as `f`, and every view in the game goes through this
function with no pixel coverage. Same rule the free-camera offsets landed under, and
[scripts/shapes/freecam.mjs](../../scripts/shapes/freecam.mjs) asserts it with `Object.is` rather
than trusting it.

**Only the Modelshop preview passes a pitch today.** Before the sim flies with one, three things
need answering and none of them is in `makeCam`: the horizon is drawn as a horizontal line, the sky
and ground are filled as two rectangles split at `horizonY`, and the cloud and fog layers are placed
against it. Under pitch the horizon is still a straight line but it *moves*, and at a large enough
tilt it leaves the canvas entirely. That is the work a 6-DoF cockpit would be, and the projection is
now the part of it that is done.

## The one idea: the arms record themselves

Hand-porting 72 arms into data would have risked the best-looking thing in the codebase. Instead the
shipping arms are **instrumented, never rewritten**. Two properties make it exact:

1. Nothing paints during an arm — every primitive pushes a closure into the depth queue via
   `emitFace`, and `flushFaces` runs them later.
2. No arm uses `Math.random`; geometry is fully deterministic from `(fh, h, m, seed, E)`.

So a module-global `SHAPE_SINK` sits beside `FACE_SINK`. When it's set, each **mass** primitive
records its arguments and returns before doing anything else, and each **adornment** primitive
no-ops. `captureShape` runs the real `drawTypeModel` against a stub ctx/cam and collects the result.

**On a real frame `SHAPE_SINK` is null**, so every guard is `if (null) return;` and the arms are
byte-for-byte what they were. `drawWorldObjects` asserts it is null on entry and logs if it leaked.

### A fourth sink: the mesh

`MESH_SINK` is the same trick as `SHAPE_SINK`, one level lower. With it set, `draw3DBoxAt`,
`drawFacetDrum`, `drawBarrelRoof` and `sawtoothRoof` record their faces in **world space** and return
without painting, so the GL spike's vertices come out of the primitives that already draw the city.
`captureModelMesh(m, opts)` is the entry point and `npm run gl:mesh` is the gate.

Two differences from the painted path, and both are because GL does that work itself: **no backface
cull** (the depth buffer decides) and **no near clip** (the frustum does). And one from the capture:
the mesh is built from the **near side** (`dyOff` as `captureAt` uses) and translated back, because
sixty arms gate part of their mass on `frontVis` and a mesh built at the origin is missing all of it
— the fuel yard's price pylon was 1.2 tiles of captured mass with no mesh under it.

### The three flags

| flag | when set | effect |
|---|---|---|
| `SHAPE_SINK` | capture only | mass primitives record and return; adornments no-op |
| `MASS_OFF` | distance LOD | mass primitives no-op; the arm still paints its **lights** |
| `ADORN_TIER` | distance LOD | `2` all adornments · `1` cheap only (beacons, masts, dishes) · `0` none |
| `ADORN_TIER` | **near** tier | `3` (`ADORN_NEAR`) adds detail that only reads at arm’s length |

`ADORN_NEAR` is the one tier that **adds**. Every guard in the file is written `ADORN_TIER <
ADORN_RICH`, so a tier above `RICH` passes all of them unchanged — the near tier cannot be noticed
by anything that already shipped. `drawWorldObjects` raises it for an arm running within
`RENDER_TUNE.detailNear` tiles (default 3) and restores it in a `finally`. It is aimed at the truck
cab, which looks at buildings from eye height 0; a cockpit almost never sees it.

⚠ **Near-tier detail must never reach `SHAPE_SINK`.** It is allowed to depend on where the camera
is standing; captured geometry is not, because it must stay affine in `(fh, h)` and it drives CFIT
collision, ground shadows, occlusion culling and the cold open. So a near-tier helper paints flat
quads through `emitFlat` and **never** `draw3DBoxAt`/`drawFacetDrum`, and opens with the house
guard `if (SHAPE_SINK || ADORN_TIER < ADORN_NEAR) return;`. The failure this guards against looks
entirely correct on screen, so it is checked by value rather than by convention: `shapes:smoke`
captures every model at `ADORN_NEAR` and at `ADORN_RICH` and fails if the segment lists differ.

### Detail that changes the wall, not just what is bolted to it

The first twelve detail kinds are all things **attached to** a wall — a pipe, a vent, a cable, a
board. That is why a model built entirely out of them still reads as a box: none of them changes
the silhouette or gives the facade any depth. Four kinds do, and they are the ones to reach for
when a building looks flat: **`windowBay`** (a surround, glazing, a shadowed head and a lit sill),
**`canopy`** (a slab cantilevered over the storey below, with an authored soffit colour),
**`signGantry`** (a billboard standing on its own legs) and **`bladePanel`** (a sign slab hung
proud of a wall with a visible edge return).

⚠ **A RECESS IS NOT DRAWABLE HERE, AT ANY PRICE, AND THE FIRST CUT OF `windowBay` WAS ONE.** Nothing
can cut a hole in a wall — a box face is a single quad — so glazing set back behind the wall plane
is behind a solid surface in both renderers. `emitFlat` sorts on **mean depth**, and the comparison
is against the wall's *centre*, so on the 2-D painter a recessed pane survives only when it happens
to sit on the camera-facing half of the facade: six of ten windows vanished, and which six changed
as the camera swung. GLASS 2 is worse and quieter — a depth buffer occludes it *correctly*, so on
the shipping renderer all ten would be gone from every angle. **Build the surround proud instead.**
At every viewing angle this game uses you see the inside of the far jamb, which is the cue a reveal
actually gives, and it is honest in both renderers.

⚠ **And a part bolted to a wall needs a `lift`, including one that projects.** Same mean-depth
sort: a slab attached near the far end of a long facade sorts behind the whole facade and
disappears, while the identical slab at the near end draws. Projecting outward is not protection.
`lift` biases the painter's sort only — the mesh is pushed before it, with raw points — so it costs
GLASS 2 nothing and cannot be used to fake depth there.

Four more kinds cover the machinery on a working building, where `pipe` and `vent` are the
domestic-scale versions of two of them and the other two had nothing: **`ductRun`** (a ribbed trunk
up a face with an elbow and an arm), **`stack`** (an extract stack with a cowl), **`louvreBank`**
(`vent` at plant-room scale) and **`tankFrame`** (a tank on a braced frame, a storey above the roof).

### The derived kit — `RENDER_TUNE.derivedKit`

`derivedTrim`'s coping band proved the pattern; `derivedKit` is the rest of the building — windows
or louvres on the biggest wall, a riser, roof plant, and a ground floor — generated off each
model's own captured shape. It reaches **127 of 173 models**: the ones with neither an authored
`detail` list nor an `ARM_DETAIL` entry.

**Hand-authoring is not available at this scale, and the numbers are what say so.** 173 models sit
under **148 distinct arms, 130 of which draw exactly one model**; the biggest arm in the city covers
four. So a per-arm trim pack buys almost nothing per list written, and each list has to be written
against one arm's own setbacks and storey heights, where a number read wrong is a window floating in
mid-air. Derivation has the opposite shape: `shapeForModel` already knows where every roof, wall and
setback is, so a part placed off it cannot float, whatever arm drew the building.

⚠ **The style axis is the PALETTE, because it is the only one that reaches every model.** The
obvious choice is the archetype (`BLDG_TYPE_3D`'s `a`) and it resolves for **45 of 173** — the other
128 are named models carrying no building type at all. `wallPaletteInfo()`'s material family
resolves **173 of 173**, because a model cannot exist without a palette, and it is the better answer
anyway: what a building is made of is what decides whether it wears ducting or balconies. The three
kits are `works`, `block` and `front`; the `plain` family is 51 models and means nothing on its own,
so it is broken by proportion — tall and slim is a block, low and wide is a works.

The sections are **wall** (windows, or louvre banks on a works), **stair**, **riser**, **roof**,
**ground**, **sign** and **cope**.

### The sign probe — does this arm already sign itself?

`sign` is the one section that cannot be read off a list. **66 of the 173 arms already sign
themselves** with a `neonBlade`, a `marqueeBand`, or lettering painted onto a frieze, and every one
of those calls lives inside the arm's own `case` where there is nothing declarative to inspect — so a
kit that simply added a board would give a third of the city two signs on one frontage.

⚠ **It is not a third capture pass, and that is the whole design.** The obvious build is a probe that
runs the arm again with a sign sink installed, and captures in this file NEST — one asked for from
inside `derivedTrim` would re-enter the arm being measured. Instead `SIGN_SEEN` rides the **shape**
capture, which already runs for every model and is already cached: the sign helpers all return early
on `SHAPE_SINK`, so they record on the way out for the cost of a Set insert on a pass that was
happening anyway. ⚠ They record **before** the tier test — a blade suppressed by distance is still a
blade the arm draws, and the question is what this building *has*.

⚠ **The label is `$name`, resolved at draw time.** The derived list is cached per MODEL and one model
serves many differently-named buildings (`type:shop` is every shop in Coldwater), so a resolved name
would put whichever building rendered first onto all of them. `$name` reads `_bladeSign`, the
building's own display name off the tile. A sign with nothing to say is not drawn at all — a blank
board reads as one whose paint has come off, which is worse than no board.

⚠ **A surface whose appearance depends on the TILE cannot live in a per-model mesh.** The GL mesh is
captured once per model without a name, so a `$name` board recorded nothing — and then `FLAT_OFF`
suppressed the canvas copy at draw time believing the mesh had it. The board vanished and its
lettering, which goes through the decal path where the name *is* known, was left floating in front of
the building. `emitFlat`'s `paint` option marks such a quad: never meshed, never suppressed.

⚠ **And then the lettering has to composite where its board does.** The GL canvas is blitted *before*
the 2-D pass, so a decal sits under everything the painter draws. Right for a board that is in the
mesh; wrong for a `paint` board, which is drawn afterwards and covers its own words. That shipped for
one iteration as a name board with lettering in GLASS 1 and a blank dark band in GLASS 2 — which
reads like text failing to render rather than like a z-order bug. `emitSurfaceText` takes `onCanvas`
for the callers that paint their own board. ⚠ `stair` is its own section rather than part of `wall`, because the two
arms that already draw one (`apartment`, `embassy`) draw a fire escape and **no** windows — folding
them together would mean those two keep their stair and lose their windows, which is exactly the
trade the merge exists to stop. ⚠ And the stair takes **the flank the riser did not**: both want a
side of the facade, and both reading the same coin flip put a downpipe through the middle of a
staircase on about half of them.

⚠ **The three wall arms are excluded** (`trm_wall`, `thornwall`, `damwall`), and it is the same
correctness rule their own arms open with: a wall is the same tile seventy times, each deriving its
own entrance facing from a door that is not there, so anything placed on a "front" points a
different way on every tile and the run reads as noise. An ordinary building wants a riser on one
flank and a door in one place; a wall cannot have either. They keep the coping band and nothing else.

⚠ **The list is cached per model, so it must never depend on a per-view tunable.** `derivedKit`
reads `RENDER_TUNE`, not the per-frame `TUNE` a view can override — two views can paint in one frame
and whichever reached the cache first would decide what the city looks like. The flag is also in the
cache key, because an A/B switch whose cache outlives it looks broken.

⚠ **The roof is the one section that can make the city WORSE, and the first cut did.** Every other
section is bounded by the wall it sits on, so it varies with the building whether it means to or
not. A roof is a bare deck, so a fixed recipe puts the same mast in the same corner of every
building — swept over 124 models that read as *more* uniform than the empty decks it replaced. Which
plant appears, which corner it takes and how big it is are all rolled from `dRand(seed, salt)`, and
the seed is the tile's own world coordinates (`tileSeed`), so a building keeps its skyline for ever
while its neighbour gets a different one. ⚠ It must stay deterministic: `models:diff` asserts two
renders of a model are identical, so `Math.random` here would fail the gate — and a roof that
reshuffled every frame would strobe.

⚠ **A contact sheet rendered at one seed cannot see any of that**, and reported uniformity that was
not real until the sheet was fixed to vary the seed per cell. Same trap as the GL cache below: the
harness was answering a different question from the one being asked.

⚠ **The ground-floor storey is clamped, not scaled.** A ground floor is sized by a door and a
person, not by how tall the block above it is, so every dimension there is `min(fraction, absolute)`.
Scaling it with the mass gave a thirty-storey tower a two-storey front door.

⚠ **Only the NIGHT colour of a window varies.** `windowBay` takes `glow` (after dark) and `glass`
(by day); varying both is wrong twice — by daylight you cannot tell an occupied room from an empty
one, and the unlit value taken from the building's own palette came out near-black on a dark wall,
so the windows read as holes punched in the facade rather than as glass.

### A hand-written list composes with the kit, it does not replace it

The selection used to read `authored || ARM_DETAIL[type] || derived` — three alternatives, take the
first. That was right while the derived answer was a single coping band. It stopped being right the
moment the derived answer became a whole kit: the 27 arm lists average **5.1 parts** and between them
use **none** of the eight new kinds, so `office`, `hotel`, `apartment`, `police`, `clinic` and
`casino` — most of the city — were the *least* detailed buildings in it, and the ones nobody had ever
touched were the best. A hand-written list now owns the **sections** it covers (`SECTION_OF`) and the
kit fills the rest.

⚠ **Only a part that could plausibly BE the whole section belongs in `SECTION_OF`.** A `vent` was
filed under `wall` in the first cut — 19 of the 27 arm lists carry one, so every one of them counted
as having a drawn facade and none got windows, which is the entire point of the merge. A `balcony`
was filed under `ground`, and the two arms that have one hang it up the shaft. ⚠ And the base list is
**concatenated, never mutated**: `ARM_DETAIL`'s arrays are module constants shared by every tile of
that type, so pushing onto one would grow it by a kitful on every cache miss, for ever.

Cost, measured: `framecost` 277,348 → 288,869 canvas calls (+4.2%) over 16 frames — a deliberate
re-baseline, with the timing that justified it recorded at the top of
[framecost.mjs](../../scripts/shapes/framecost.mjs). The GLASS 2 mesh goes 13,874 → 24,153 faces.
⚠ **The call count and the clock disagree here, and the clock wins.** Timed on a real street, 70
frames after 25 warm-up, adaptive dials pinned, two runs per setting: GLASS 2 measures **3.90/3.50 ms
without the kit against 3.70/4.10 ms with it** — the runs disagree about which is faster, so it is
inside the spread and is not a finding, at 2.3× the trim geometry. GLASS 1 measures **+0.6 ms on an
11 ms frame**, and only runs where there is no WebGL2. The 2-D painter runs the detail layer only
inside `RENDER_TUNE.detailNear`, so its cost is bounded by how many buildings are near you; the mesh
is not gated, which is why `KIT_MAX` and `WIN_MAX` cap what one building can spend.

⚠ **The jambs and mullions of a `windowBay` are MESH-ONLY**, which is the same bargain `ADORN_NEAR`
itself is struck on: a depth-buffered quad is nearly free and a canvas one is not. GLASS 2 carries
the whole reveal; the painter draws the four faces that read (surround, head, sill, glass) and skips
the two that are edge-on from almost every angle. Putting the full set on the painter measured 12.6%
over on the dense cab frame.

⚠ **A/B-ING THIS AT RUNTIME LIES, AND IT LIED CONVINCINGLY.** Flipping `derivedKit` between two
`paintWindshield` calls in one page measured **1 changed pixel** on a street and looked like proof
the kit does nothing in the shipping renderer. It does not: `gl/world.js` caches a tile's mesh on
the model's identity keyed by `meshParams`, and `shapeForModel` caches on identity too, so the
second render was the FIRST render's cached geometry. Measured properly — one page load per setting,
capture to disk, diff offline — the same street is **1,664 → 4,254 GL faces and 3.28% of the frame**,
most of which is sky and road. `renderModelPreview` is safe to flip at runtime because it does not
go through the GL buffer; `paintWindshield` is not.
`doorReveal`, `mullions` and `glazeParallax` (the recessed door, the proud frame and the glass set
back behind it, all on the `shop`/`default` arm) are the worked examples. The glazing shows what the
tier is for: the pane is GENUINELY recessed behind the frame, so the parallax as you drive past is
done by the camera rather than faked from a view angle, and it costs one quad per bay.

`MASS_OFF` is what makes the LOD nearly lossless, and it is only viable because of a measurement:
**running an arm costs ~3.2 ms/frame while queueing its faces costs ~14.6 ms.** The arm's JS was
never the problem.

## The segment schema

Model-local, captured at the canonical entrance vector `E = [0,1]` (where `facePt` is the identity).
Every geometric scalar is an **affine triple `[a, b, c]` meaning `a·fh + b·h + c`**.

```js
{ kind: 'box'|'drum'|'barrel'|'sawtooth', cx, cy, z0, z1, pal, frontOnly,
  hwRaw, fdRaw, yaw, roof,     // box — both PRE-clamp; fdRaw === hwRaw for a square one
  rb, rt, n, cap,       // drum
  cxL, hl, hw, archH, nf, base,          // barrel
  hx, hy, rh, teeth, roofc, glassc, edge // sawtooth
}
```

Three things here are load-bearing and easy to get wrong:

- **`hwRaw` is pre-clamp.** `draw3DBoxAt` clamps a half-width to `0.44`, an absolute world constant,
  while everything else is a multiple of `fh`. A post-clamp number would only be valid at the one
  footprint it was captured at. **Consumers re-apply `min(hwRaw·fh, 0.44)`**, and the data stays
  invariant to the `bldgFoot` / `bldgH` / `bldgStretch` sliders.
- **A box has TWO half-extents, and the second one is why.** `fdRaw` is the half-*depth*; for the
  ~500 square boxes it equals `hwRaw` and nothing behaves differently. It exists because
  `draw3DBoxAt`'s footprint used to be square only, which meant an **awning wide enough to span a
  shopfront necessarily reached the same distance out into the road** — a dark half-tile slab hanging
  over the street off every storefront in Coldwater, at one height, plainly visible from the cab three
  blocks away. Awnings go through the `awning()` helper now (wide across the front, shallow into the
  street, anchored by its outer *lip* rather than its centre), and `fdRaw` is what carries that
  through capture so the distance LOD, the ground shadow, the footprint hull and the CFIT/truck
  obstruction probe all agree with what you can see. Consumers re-apply the same `0.44` clamp to it.
- **The basis is solved, not assumed.** "Widths scale with `fh`, heights with `h`" is *wrong* — nine
  models derive a vertical from the footprint (a barrel roof's rise is proportional to its span).
  Capture solves `a`, `b`, `c` from three passes at different scales and verifies against a fourth.
- **The constant term `c` is real.** The Layover's cone apex passes a literal `0.001` radius.
  Supporting `c` keeps that arm untouched; the bake **warns** on any non-negligible constant, since
  a constant is also what a modelling slip looks like.

### The `yaw` trap

Rotating a model to its entrance vector `θ(E) = atan2(-E[0], E[1])` must rotate the segment's
**centre** *and* add `θ(E)` to the segment's **`yaw`**. Miss the second and the three twisted towers
(Halcyon, Solenne, `asc_spire`) sit in the right place with their footprints turned the wrong way —
small enough to ship unnoticed. Where practical, transform the four corners individually instead and
the question disappears; that is what the cold open does.

### Spars (masts) — recorded, but never mass

`mast()` pushes `{ kind: 'spar' }` into the sink, and **`shapeForModel` hands spars back on the
returned array's `.spars` property rather than inside it**. So collision, footprint, shadow, roof
height and LOD are byte-for-byte unaffected — you still don't CFIT into an antenna — while a consumer
drawing the silhouette can ask for them.

They exist because a mast is *structural to the picture*: several arms hang a crown box, a finial or
(the Dead Pigeon) a stuffed bird off the top of one, and without the spar those pieces float in the
air over a gap. `shapeWireList` appends them **outside the `max` budget** (one line each, they can't
push a real piece off the list) as `kind: 'mast'` with zero `hx`/`hy`, and never flags one `tall` — a
consumer sizing a camera to clear the city should clear the roofs, not the antennas.

### The two hand-rolled shells

The bank's stone dome and the Meridian's ogee cupola are revolved out of `cam.proj`+`emitFace` rather
than through a mass primitive, so capture used to miss them. That cost nothing in collision or shadow
— each is subsumed by an adjacent box in both height envelope and footprint hull — but it cost the
wireframe its contour, and the stone lantern on each shell's apex was left standing over a hole. Both
now push a **tapered drum** into the sink beside their draw loop, which is what a revolved shell is at
cage resolution. Any future hand-rolled shell should do the same.

### Trimming a stack: keep it continuous

`shapeWireList(m, max)` ranks by **visual mass**, which for a stacked tower spends the budget from the
ground up. Solenne is 26 twisted slabs: the first eight kept pieces reached 1.1× the storey stack and
the ninth was the crown at 3.05× — a tower missing two thirds of its shaft with its hat in mid-air.
Hall of Records did the same. So after ranking, any **vertical gap under the tallest kept piece** is
filled with the dropped segment nearest the gap's midpoint, stretched to span it (a stack tapers
slowly, so a mid slab is a faithful footprint). Fillers come out of the **same budget** — it keeps one
fewer ranked piece until the whole thing fits — so per-frame stroke cost is unchanged. All 83 models
are now gap-free at `max = 9`.

## Consumers

| consumer | reads | notes |
|---|---|---|
| **Distance LOD** (`drawModelLOD`) | live capture | past `lodNear`, mass from segments + the arm's lights |
| **Occlusion culling** | live footprint hulls | skips buildings fully hidden behind a nearer one |
| **Ground shadows** (`drawBuildingShadow`) | live capture | real hull + real roof, not one square |
| **Collision** (`buildingRoofFtAt`) | live capture | per-POINT roof height in feet |
| **The cold open** | the **baked** file | must not import windshield on a first login |

Collision deliberately reads the **live** capture rather than the bake, so models whose shape varies
with the tile seed (rooftop clutter) collide as they are actually drawn on that tile.

**Hitting a building is fatal unless you were barely moving.** The outcome is a SPEED rule, not a
depth rule (`CFIT_BOUNCE_KT = 18`, cockpit.js): at or below a crawl she **bounces** — shoved back
along her own track, stopped dead, a scrape's worth of hull — and above it she is written off,
however shallow the graze. This replaced a penetration-depth test that let a 140kt scrape along a
roofline count as a survivable "clip" while a helicopter drifting sideways into a wall at 8kt died.
The bounce is a **positional shove, not a pop up to the roofline**: the old version lifted you to
`roofFt + 25`, which would throw a heli hovering beside a tower straight up onto its roof. The point
is to be kept OUT of the structure, not lifted over it.

## The bake

`client/shared/building-shapes.js` is generated — **never edit it by hand**.

```bash
npm run shapes:bake
```

It runs in plain node: windshield loads under [scripts/shapes/dom-stub.mjs](../../scripts/shapes/dom-stub.mjs),
so there is no browser step and no dev-panel button. The baked file holds the **~9 most defining
segments** per model (`MAX_SEGS`), in **rank order**, with the **tallest always kept and flagged
`tall`** — a spire has almost no bulk and would otherwise be trimmed first, which once reported
Halcyon's roof as `1.0×` its storey stack instead of `2.9×` and would have flown the cold open's
camera straight through it. It was 5, which buys the mass, one setback and the spire — enough for a
silhouette and not enough for a building.

Every segment carries a **bounding box** (`cx cy hx hy z0 z1 yaw?`), and a segment that is not a box
also carries its **`kind`**: `drum` adds `{ rb, rt, n }` (a faceted, possibly tapered cylinder) and
`arch` marks a barrel roof. A consumer may draw the real contour or just the cage — the cage is
always present, so this is a detail upgrade and never a dependency. It exists because boxing all 39
drums turned every tank, silo and round shaft in Coldwater into the same slab as the shop next door.

The prologue manifest ([plugins/prologue/index.js](../../plugins/prologue/index.js)) ships `n`
(building name) and `e` (entrance) alongside `{x,y,t,f}`. Both are load-bearing: the name resolves a
landmark to its own model, the entrance is the frame the geometry is laid out in. `regress.js`
asserts the city still carries them, so a rename or a lost `facade` tag can't silently downgrade
every landmark back to a box.

## Looking at a model — the Modelshop

The renderer these models belong to is **GLASS** (Geometry, Lights, Aircraft, Streets &
Structures), and [tools/modelshop](../../tools/modelshop/README.md) is its editor:

```bash
npm run modelshop     # http://localhost:5181 — also started by npm run dev
```

Phase 1 is an **inspector**. It lists every model from `shapeModelRegistry()` and draws it
through `renderModelPreview()`, which is a named entry into the real `drawTypeModel` — the same
seam as `shapeRenderSmoke`, and for the same reason: a second preview renderer would agree about
geometry and disagree about wall texture, night lighting, face order and glow, so a model would
look right in the tool and wrong out of the windscreen.

It surfaces four things that were previously only reachable by flying to a building or by reading
a bake diff: the **shape cage** live at any `fh`/`h`/seed/facing, the **nine segments the bake
keeps** (so a tower that the gap-filling rule left headless is visible immediately), the
**constant-term warnings** this doc describes, and the **adornment cost** in gradients and blurs.

⚠ **Use the Cab preset.** `ADORN_NEAR` is aimed at eye height 0 and a cockpit almost never sees
it, so authoring only from the cockpit view is exactly how near-tier detail ships broken.

There is still **no pixel comparison** (see Verification below). The Modelshop is where you look
at a model; it does not assert that one looks right.

### Authored models — the data half

A model no longer has to be an arm. One JSON file per model under `content/building_models/`,
compiled by `npm run models:bake` into the generated `client/shared/building-models.js`, which
windshield.js imports and merges into `NAMED_MODELS`/`TYPE_MODEL` at load. The schema is
[client/shared/building-model-schema.js](../../client/shared/building-model-schema.js).

**The bake resolves an authored file into exactly the shape this document already describes** —
every geometric scalar as an affine `[a·fh + b·h + c]` triple, under the primitive's own argument
name. That is the whole trick: by the time anything draws one, an authored model and a captured one
are the same data. `drawAuthoredModel` then calls the *real* mass primitives, so `SHAPE_SINK`
records it identically and every consumer in the table above works on it unchanged — the worked
example ([content/building_models/foundry.json](../../content/building_models/foundry.json))
entered the bake above with nobody wiring it up.

An author writes plain numbers in tile units at a fixed basis (`fh` 0.4, `h` 1, the pair
`captureRawPass` itself uses) and tags what each field scales with; the triple is derived. A mixed
triple is deliberately not authorable — if a model needs one, it is a code arm.

Two rules, both enforced rather than described:

- **A hand-written arm always wins.** The merge is `??=`. `models:bake` refuses two authored models
  claiming one key, and `shapes:smoke` reports an authored binding a code arm shadows — otherwise
  it is inert, and inert looks exactly like nothing going wrong.
- ⚠ **An adornment must project at a FINITE position.** Every adornment helper guards with
  `if (p.f <= 0.1) return`, and `NaN <= 0.1` is **false** — so a mis-named argument sails straight
  past the bailout and paints at NaN, which a canvas draws as nothing and reports no error. The
  model renders perfectly with its neon, beacons and masts silently absent, and it reached the
  committed skyline bake that way once already. `authoredAdornSmoke()` checks the ARGUMENTS rather
  than the output, which is what lets it run in node with no pixels.

Boxes and drums are authorable; barrel and sawtooth are not yet, and neither blocks authoring a
building. Editing is still by hand — the Modelshop has no write path.

### Does it draw the same picture? — `models:diff`

```bash
npm run models:diff -- type:foundry named:thefoundry   # compare any two
npm run models:diff -- --ported                        # every ported model against its arm
npm run models:diff -- --determinism                   # every model, rendered twice
```

⚠ **It compares drawing OPERATIONS, not pixels, and it is deliberately not called a pixel diff.**
A pixel comparison in node needs a native canvas dependency and a build toolchain in CI, in a repo
whose premise is no build step. So a model is rendered against a recording context
(`captureModelTrace`) and the recordings are compared, over 48 cameras — day and night, four
facings, three scales, two seeds. It **over-reports**: a different draw *order* is the same picture
and a different trace. That is the safe direction for a gate, and it means a non-zero distance is a
question rather than a verdict. The Modelshop's Difference panel settles it in real pixels.

A port is declared by `portedFrom` in the authored file, which flips the merge rule so the data
model overrides the arm — and **the arm is kept**, in `LEGACY_MODELS`, so the claim is re-checked
on every push for as long as it exists, and `RENDER_TUNE.legacyArms` puts the whole city back on
the hand-written arms with one flag (it reaches CFIT, not just the render). Delete an arm in a
later commit, once the port has flown.

**Determinism is the precondition**, and it is now asserted for all 173 models: the same model at
the same camera must produce the same trace twice. A `Math.random` or a real-clock read in an arm
would otherwise make that building different on every frame with nothing here to notice — the
capture harness probes seeds but holds `now` fixed and never renders one model twice.

### ⚠ Why the arms cannot be ported to authored data

`npm run models:survey` ([scripts/shapes/autoport.mjs](../../scripts/shapes/autoport.mjs)) generates
an authored model from an arm's own capture and then measures it against that arm. **Zero of 172
arms port faithfully**, and the reason is worth knowing before anybody tries again:

| | |
|---|---|
| 129 of 172 | expressible as authored boxes and drums (43 are not: 30 entrance-face-only mass, 12 barrel roofs, 1 sawtooth) |
| 79 of 129 | **byte-identical to the arm at the capture conditions** |
| 0 of 79 | break when the footprint or storey height changes — **the affine basis is exactly right** |
| 10 of 79 | break on a different tile seed |
| **79 of 79** | **break on a different entrance facing** |
| 69 of 79 | lose something visible once adornments are back on |

**Facing is the blocker, and it is unanimous.** Capture runs an arm once at the canonical
`E = [0,1]` and an authored model reproduces that shape rotated — but an arm is **not** a pure
rotation of its own capture. The control proves it: the arms differ from `drawModelLOD` itself in
all 258 non-canonical-facing cases tested. That is fine for the LOD, which only takes over past
`lodNear` and is an approximation on purpose. It is not fine for a port, which replaces the arm at
every distance including the truck cab at arm's length.

So the arms stay as code, and the authored format is for **new** buildings. Porting would first
need capture to record all four facings (or facing-conditional geometry in the schema), adornments
to survive `SHAPE_SINK`, and per-box seeds and drum style functions to be recorded — each of which
is design, not effort.

## Verification

```bash
npm run shapes:smoke     # also runs inside pretest:regress
```

Three gates, ~1 second, no browser/DB/network:

1. **PAINT** — every model runs through `drawTypeModel` + `flushFaces()`, night and day, both
   facings, plus the adornments-only and LOD paths. This is the **only** automated coverage the
   windshield has ever had. It exists because the Battery Acid roaster passed a palette *key* where
   `drawFacetDrum` wanted a style *function*, and since nothing but a passing player ever ran an arm,
   it sat there until it threw mid-frame and froze the sim.
2. **SHAPE** — geometry must be affine in `(fh, h)` and reproduce at a scale the decomposition never
   saw.
3. **STALE BAKE** — re-captures and compares against the committed file, naming the models that
   drifted. A direct comparison, not a hash, so it says *what* changed.

There is still **no pixel comparison**. These prove models run and geometry is sound, not that a
building looks right. Use the wireframe overlay for that.

## Tuning knobs (⚙ in the cockpit, or `__wsTune` in the console)

| knob | default | what it does |
|---|---|---|
| `shapeWire` | 0 | stroke captured shapes over the render — cyan mass, amber entrance-face, magenta core |
| `lodNear` / `lodFar` | 20 / 32 | where segments take over from the arm, and where detail bottoms out |
| `lodAdorn` | 1 | distant lights: 2 all · 1 cheap only · 0 none |
| `occlude` | 1 | skip fully-hidden buildings |
| `shapeShadow` | 1 | hull shadows (0 = the old square) |
| `glowFar` | 11 | distance within which neon earns a real `shadowBlur` |

**`lodNear = 0` and `shapeShadow = 0` together restore the pre-capture appearance**, which is worth
knowing when judging whether something looks wrong because of this system or in spite of it.

## What this bought, measured

- LOD: **33.9 → 5.9 faces per building** at range (83% fewer)
- Glow sprites: **141 → 3 gradients** per skyline, at *every* distance
- Neon blur gating: **81 → 24 blurs** beyond `glowFar`
- Collision: Halcyon's roof **264 ft → 766 ft**, and genuinely tapered — 766 ft at the centre,
  480 at 0.3 tiles out, 0 at 0.5

That last one is a **deliberate difficulty change**: collision now matches what is *drawn*, and the
renderer stretches storeys for drama (`bldgStretch = 5.0`), so tall landmarks are much bigger
obstacles than "22 floors" implies.

## Not built

- Pixel/visual regression of any kind.
- The remaining 24 inline `shadowBlur` sites in the arms (helix light-runners, holo ads).
- Content-authored shapes — models are still code; this only made them *readable*.
