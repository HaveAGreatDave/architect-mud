# GLASS frame headroom

**Status: Stage 1 started (the bench fixed, per-frame GL state queries removed); the 2026-10-01 record caches built (below); Stage 1b built; Stage 3 phases 1-5 built, phase 6 started, kept-arm follow-ups built (2026-10-06 and 07, below); kept arms made to work for a moving camera (2026-10-19, below); flat decal fills batched (2026-10-19, below); the caches keyed on the map window made to survive a recentre (2026-10-19, below); Stage 2 superseded by Stage 3.** The vertex-animated layers it follows from are built (actors,
birds, cloth; see [glass-notes.md](../reference/glass-notes.md#vertex-animated-layers-actors-birds-cloth)).

## Built 2026-10-19: what a recentre still paid

The section below left a recentring flight with a worst frame of about 106 ms against a p99 of 42 ms
when the centre holds still. Per phase (`perf:move --rows` prints every profiler phase now), the push
frame was the floor's material LUT (25 to 48 ms), the camps inside `world:arms` (11 to 30), the road
tiles (5 to 15), the flock search (5) and the floor's byte planes (2 to 10). The occluder cache barely
moved. And `perf:move` stubs the GL pass, so it never saw the biggest one: run for real under the fake
WebGL2 (`--gl`, new), a recentre spent 73 to 166 ms in `world:gl` rebuilding the whole mass buffer, about
ten million floats, against 10 ms on other frames.

Each fix has its own `RENDER_TUNE` switch, 0 being the old path:

- **`lutShift`**: a new window takes each floor LUT entry from the old one at the same world tile,
  unless a cell within its reach is a different object or has come into or gone out of the window
  (`windowChanges`, `lutKeep` in windshield.js). The reach is one tile for a road or water entry and
  `FOOT_REACH` (9) for bare ground, which the footfall pass reads that far. `footfallFill` takes a mask
  of the tiles to write and runs its earlier passes only as far out as those read. A one-tile recentre
  keeps about 3,950 of 5,329 entries.
- **`footFast`**: footfall's first pass reads each tile's pull and Curtain flag into typed arrays once,
  instead of through `at` for 24 neighbours of every tile, summing in the same order. A full pass went
  from about 12 ms to 5 warm.
- **`campWorld`**: a kept camp was keyed on its place in the window, so every recentre recorded every
  camp in view again. It's keyed and shifted in world tiles now, as `armWorld` does for buildings.
- **`groundWorld`**: a road tile's cache entry carries the window it's valid in and the centre its
  records were made about. Once per new window `gtWindow` checks each entry's neighbourhood
  (`BLOCK_MAX` + 2) against the old window, and a replay moves the records by the change in centre
  (`gtShift`). ⚠ It also fixes a bug: with interning, a resend with the same centre kept a road tile
  whose neighbour had changed, so its kerbs were stale until the next recentre. With `groundWorld` on,
  the cache matches no cache at all under churn.
- **`flockShift`**: the flock search takes the last window's habitat answer for a tile whose 3x3 didn't
  change. `lastFlockAnchors()` is its test seam.
- **`massKeep`**: the mass buffer is kept tile by tile (`uploadKept` in gl/context.js). Each group
  carries a key, its world tile and everything its mesh was built as, and positions in world tiles
  less an anchor that holds between full builds (gl/world.js). The mass shader adds `uMassShift` (the
  anchor less the window's centre), and the shift is folded into the sun's, the SSAO depth's and the
  fade pass's matrices. A new window keeps the groups it shares with the last, writes the new ones over
  the holes the departed ones left (zeroed, so they draw nothing) or on the end, and sends only those
  ranges. An atlas repack, a full buffer, holes past 35% or a window 48 tiles from the anchor packs it
  whole. ⚠ The draw order is now the slot order, which only coplanar faces and the faded band can see.

**Numbers**, headless, Halcyon cockpit, `npm run perf:move -- halcyon cockpit --frames 240 --prof
--turn 0.2 --resend 60 --recentre --intern`, all six off then on:

| | push frames (ms) | worst | p99 | `world:gl` at a push | floats written at a push |
|---|---|---|---|---|---|
| stub GL, off | 72-119 | 110-119 | 48-55 | | 0.4-0.6M |
| stub GL, on | 36-72 | 72 | 45-54 | | 0.4-0.6M |
| stub GL, same centre | 18-27 | 50-53 | 37-44 | | 0.25M |
| `--gl`, off | 144-179 | 179 | 84.8 | 73-88 | 10.4-12.1M |
| `--gl`, on | 53-85 | 85 | 53.1 | 12-17 | 1.8-3.4M |
| `--gl`, same centre | 27-36 | 60 | 43.7 | 9-10 | 1.0M |

In the browser (the Modelshop page, real WebGL2, the same flight), a push frame went from 116-181 ms
to 42-62 ms, and the picture with `massKeep` on differed from the old path by 540 to 1,540 pixels of
230,400, inside the 600 to 1,300 by which two runs of the old path differ from each other.

**Proved** by `npm run perf:exact` for each switch (60 still views; `campWorld` with `--layers`, see
below), `npm run perf:armkeep` (its recentring flight included) and `node scripts/gates/run.mjs shapes`
(140 of 140). A still view never recentres, so there's a new check for the moving case:
`node scripts/perf/recentre-exact.mjs <key> [off] [on]` flies the `perf:move` route in two processes,
one per value, and compares every frame: each list the GL hook is handed, the floor's LUT and byte
planes, the GL cells, the flock anchors and the canvas log. `--churn K` also changes K cells near the
craft at each resend, because a recentre alone only moves cells at the window's edges and never asks a
cache whether a neighbour changed. All five CPU switches pass, at Halcyon in the cockpit and Marrow in
the cab, with and without churn, and a mutant of each one's reach or shift is caught. The mass buffer
was checked tile by tile instead (per-attribute sums, matched by tile): equal to float32 rounding.
`perf:exact --layers` leaves out the CPU fallbacks no layer reads once the GPU does the job (a pulled
decal's `p`, a pulled stroke's `a`/`b`, a sized sprite's `r`). A kept camp holds those from the frame
it was recorded at, so `campWorld` changes which recording a still view replays, and differs there and
nowhere the picture can see.

**What a push still pays**, about 30 to 50 ms over a still centre: the LUT's rebuilt edge bands (7 to
26 ms; the first recentre of a run is cold), the floor's byte planes (2 to 9, rebuilt whole because
the shelter march and the seabed distance field read the whole window), kept bays shifted and re-sent
(2 to 6), perch plans (1) and the shadow map drawn again because its matrix moved with the bounds.

## Built 2026-10-19: a moving camera

Every bench before this one turned the heading over a fixed tile. A flight or a drive moves the camera
through the tile every frame (`mapOffset`), and the server sends a fresh map window on every context
push. Under those two conditions most of Stage 3 wasn't working. `npm run perf:move`
([scripts/perf/movecost.mjs](../../scripts/perf/movecost.mjs)) flies straight ahead under a fake WebGL2.
`--resend N` replaces the window with fresh JSON every N frames, `--recentre` moves its centre as the
server does, and `--intern` takes it through the client's intake. It reports floats written, layer
draws, kept-arm counters and, with `--prof`, phase times. Numbers below are headless at Halcyon in the
cockpit; node runs about twice the browser.

**A straight run never kept a building.** A probe counts as a camera move only if the pose differs,
and the pose held the chase offset and the heading but not the travel through the window. So the
second probe never came. Flying straight, `world:arms` went from 21.7 to 12.7 ms, the paint median from
32.1 to 25.7 ms and floats written from 269k to 153k a frame (`armPoseMove`).

**Retained groups were re-sent every moving frame.** The sprite, stroke and decal layers keyed a group
on its offset as well as its records. `armReplay` hands the same records back each frame, shifted, with
that frame's offset, so the key changed every frame the camera moved. Moving and turning, floats
written went from 372k to 234k a frame and the worst frame's upload from 11.8M to 354k floats. The
layers now key a group on its records and its window (`w`), and write it with the offset it carries
now. ⚠ `splitGroups` in gl/context.js rebuilds every group, so a new field on a group has to be
copied there or it never reaches the layer.

**Every push threw away every cache.** About 150 buildings probed on the push frame, three arm runs
each, and again a dozen frames later. The client now interns the window
([map-intern.js](../../client/game/js/panels/map-intern.js)): an unchanged cell keeps its object, and an
unchanged window keeps its array. Kept arms are keyed and shifted in world tiles (`armWorld`), so a
recentre keeps them. Bay records are in the window's frame, so they move by the change of centre.
Resent every 60 frames with the same centre, the worst frame went from 145 to 49 ms and p99 from
65.6 to 42.3 ms. With a recentre at each push, probes went from about 500 to 129 over 210 frames, and
the worst frame from 227 to 106 ms. What's left at a recentre (p99 about 63 ms) is the caches still
keyed on the window, listed below.

**Three kinds of camera term inside arms, which a turning bench can't see.** A turn moves the
heading, not the eye, so none of these changed between two probes:

- The signs-only pass draws lettering only inside `signFar`. A building kept from outside that range
  held no signs and stayed blank as you flew in. It's in the kept key now (`signIn`).
- Back-face tests against the eye's position: `emitFlat`'s `cullN`, `frontRing`, `ashBand`, a blade's
  sides, `slumFaceVis` and five local facing helpers in the model files. They all go through
  `faceAway` now, which records each answer while an arm records (`ARM_FACE`), and a replay that would
  answer differently drops the kept set, as `webBays` already did. coliseum.js line 341 still reads
  the eye directly; it was being edited elsewhere.
- Continuous camera terms (a vat body turned to the eye, `camA` on the waterfront) differ between two
  probes, so they already went live. They need nothing.

`perf:armkeep` now flies two straight runs and a recentring one as well as the turns; `MOVETURN=0.5`
adds a turn to the straight runs. All of them match the live draw.

**The reflection cube's key** took the sky colours unrounded, so each hour the server sent re-drew six
faces and the mips. It rounds them to whole 8-bit steps, as it already did for the ceiling.

### Still to do, in order of what was measured

1. **The caches still keyed on the window.** Built, see the section above. What a push still pays is
   listed at its end: the floor's byte planes, the LUT's edge bands and the kept bays.
2. **Decal draw calls.** Built, see the next section: 765 decal draws a cockpit frame to 168. What's
   left is artwork with a texture each.
3. **The ground is re-packed every frame**, about 12,000 quads. The kerb width and far fade depend on
   the camera; in the shader, cached tiles could sit in an arena.
4. **The sweep's lateral cull covers buildings only.** Scatter, wires, steam and parks off the side of
   the screen still run their drawers. `items.sort` sorts every item although only the occluder pass
   needs an order.
5. **The kept-arm key holds `night` and `_frameDpr` unquantised**, so every kept building re-keys
   through dusk and on each step of the resolution dial.
6. **Smaller:** the cloud composite runs bloom a second time (GPU, and dropping it changes bright
   cloud edges); up to four GL-to-2-D canvas copies a frame; other vehicles transformed on the CPU;
   the adaptive dials read the frame interval and can't tell CPU from GPU.

## Built 2026-10-19: decal draw calls

Every flat fill was its own texture. `emitDecoFill` baked an 8x8 `solidTex` per colour and a 4x32
`rampTex` per gradient, and the decal layer drew one batch per texture, each with a bind and a `uCull`
uniform, then the same again in the depth prepass for solid boards. A Halcyon cockpit frame in
`perf:move` drew 765 of them. All but about 130 of its 1,235 decal records were flat fills: building
trim through `emitDecoFill`, and camp cloth past arm's length (`clothFlat`, a one-colour page).

`RENDER_TUNE.glDecalTint` (1; 0 is the old path) puts the colour on the vertex. `cssTint` turns the
fill's CSS into the premultiplied RGBA8 its page would have held, packed into one float slot that the
shader reads as four normalized bytes (gl/stream.js now takes an attribute type). A ramp carries its
two stops on its top and bottom corners. Every tinted record draws off one white texel in one batch,
in the order it arrived and before the artwork. `cull` is a vertex attribute (`aCull`), and the depth
prepass draws a batch's solid quads as sub-ranges of it. A retained group's tinted records are one
part, and every kept tint span goes in one `WEBGL_multi_draw` call per pass (a loop of the same
draws without the extension). Records with real artwork (lettering, flags, near cloth pages) keep the
old grouping by texture, cull and solid.

Headless, `npm run perf:move -- halcyon cockpit --prof --turn 0.2`, the decal layer alone, three runs
each:

| | before | after |
|---|---|---|
| draws a frame | 765 | 168 (206 without multi-draw) |
| texture binds | 765 | 168 |
| `uniform1f` calls | 648 | 8 |
| floats written | 81k | 95k |
| layer CPU, median | 2.1 to 2.6 ms | 1.4 to 1.6 ms |

In the Modelshop (Chrome, which has the extension), counting every GL draw in the frame at Halcyon:
the cab view went from 397 to 311 and the air view from 797 to 458, with binds falling by the same.
`world:gl` didn't move beyond its noise: medians of five alternating runs were 7.97 and 7.42 ms from
the cab, 11.58 and 12.07 ms from the air. The mirror pass uploads the same records without groups, so
on a wet frame its fills are one draw as well (not measured on its own).

The picture: `__glRefShots` with the switch at 0 against a set saved at 1 in the same session
(Halcyon and Marrow Street, cab and air, noon, dusk, night and storm) moved at most 1.19% of pixels,
against a floor of 1.27% for 0 against 0. Two differences are expected and small: a ramp is
interpolated per vertex rather than read from 32 nearest-filtered texels, and fills blend in arrival
order rather than grouped by colour. `perf:retain` (at 0 and at 1), `perf:armkeep` and
`run.mjs shapes` pass.

What was left was artwork with a texture each, about 80 textures a frame here and twice that for the
ones in the prepass. See the next section.

## Built 2026-10-19: decal artwork on shared pages

The 80 were real artwork: sign lettering pages (`st:*`, `gt:*`, the named boards), blade faces, arc
flags, the lock banners, helideck and pylon art, near cloth pages. A census of one frame found 97
distinct keys, 3.5 M texels in all, the widest the 1536x112 lock banner and the tallest a 128x512
blade face.

`RENDER_TUNE.glDecalAtlas` (1; 0 is the old path) copies artwork that fits (at most a quarter of the
page tall) onto a shared page, 4096x2048 where `MAX_TEXTURE_SIZE` allows and 2048 square otherwise,
up to two pages. Each vertex carries its artwork's cell in texels (four uint16s, `aCell`; stride 14 to
16 floats), and `vUV` is still 0..1 across the artwork. Every tap goes through `cellUV`, which clamps
half a texel inside the cell: that's what `CLAMP_TO_EDGE` did on a texture of its own, so the neon
shader's neighbour taps, its stand-off shadow and the edge fade never read the next sign. The tube
maths takes the cell's size (`vCell.zw`), not `textureSize`, which is now the page's. A page is LINEAR
both ways, so artwork that isn't `smooth` carries a flag bit and the shader snaps its tap to the
texel centre when one texel covers more than a pixel, where GL would have used the NEAREST magnify
filter. A texture of its own is the cell (0, 0, w, h), so the 0 path draws what it did.

Draw order doesn't change: records still group by artwork in arrival order, and neighbouring groups
on one texture become one `range` (one `WEBGL_multi_draw` call, or a loop without it). That's why a
page is 4096 wide: at 2048 square this set needed two pages, the groups alternated between them, and
the frame still took 68 binds. Packing is shelves, tallest first then by key, so two layers given the
same artwork pack it the same way (`perf:retain` compares them byte for byte). When the pages are
full, a page nothing has drawn for 8 uploads is emptied whole, else a second page is made, else the
artwork gets a texture of its own (`spill`) and goes back onto a page the next time one is emptied.
A retained part remembers its cell; if the cell moved, the part gets a new arena id and is written
again. `prepare` does all of this before a vertex is written. The decal layer's `batches` counter is
now the last draw's texture binds, and it reports `own` and `pages` beside `textures`.

A blade's dark sides (`'blade|solid|' + dark` through `emitDecoQuad`) now carry their colour on the
vertex and join the tint batch, as `glDecalTint` intended.

Headless, `perf:move -- halcyon cockpit --prof --turn 0.2`, the decal layer alone (a copy of the
script that counts only `drawDecals`), three runs each:

| | before (tint only) | blade tinted, atlas 0 | atlas 1 |
|---|---|---|---|
| draws a frame, with multi-draw | 168 | 164 | 12 |
| draws a frame, without | 206 | 206 | 90 |
| texture binds | 168 | 164 | 12 |
| floats written | 95k | 108k | 108k |
| `drawDecals` CPU, median | | 1.48 to 1.53 ms | 1.28 to 1.44 ms |

The fake context's calls cost nothing, so the CPU column says only that packing and the cell lookup
are cheap; the saving is driver work per call, which this can't time. The floats rose with the stride.

The picture: in the Modelshop, `__glRefShots` with the switch at 1 against a set saved at 0 in the
same session (16 shots) moved at most 1.43% of pixels (Marrow air noon); two runs of 0 against 0 put
that shot at 0.83% and 1.85%, and every other shot was within 0.15 of its floor. `perf:retain`,
`perf:armkeep` and `run.mjs shapes` (140 gates) pass.

Not measured: the Modelshop's own frame counts and `world:gl` with the switch on and off. The pane
was hidden for this run, so its timings mean nothing.

## Built 2026-10-07: what kept arms still missed, camps, posed instruments

**Why buildings went live.** `armKeepWhy` (off by default; a harness sets `.on`) records the reason
per model type. Over twenty views most live buildings were not animated at all: a glowPool also
enters the frame's light census (`RAIN_LIGHTS`), a side channel, so 70 of 72 live authored buildings
went live for a glow. `armRain` records the glow's world inputs and a replay re-runs only the census
step. Of what was left, most animated through helpers handed the clock (smoke, revolving rings, beams,
wind wheels, flags): `armLive` keeps the call and its arguments, cuts its records out of the kept set
and calls it again each replay. Halcyon cockpit, full arm runs a frame (headless): 82 to 28.

**What a running clock exposed.** `perf:armkeep` ran with the clock frozen, which hid four holes, all
fixed: `deadNeon` reads the wall clock rather than the arm's `now` (the clock test moves it too,
`ARM_SHIFT`, and a second test runs at +9.9 s for slow cycles); a crane's duty cycle can be parked at
both clock tests (`dutyPhase` asked during a recording makes the building live); `webBays` is a camera
term inside arms (each answer is recorded and a replay that would answer differently drops the kept
set); and a clock test's sign bakes shifted every later sign's id (`SIGN_ID_SCRATCH` hands them back).
Two more: a building fading in the haze band re-keyed every frame and probed every frame (three arm
runs where live is one; it now runs live until fully in, and a re-keyed entry can't probe more often
than ARM_GAP), and a live building is probed again after `ARM_RETRY` frames. The check now runs the
clock at 16 ms a frame (at 33 ms the scene governor steps the tune every 400 ms and re-keys
everything), flies each pass in its own process, adds Old Coldwater, and compares the light census.

**The governor no longer re-keys kept arms** (fixed the same day). `ARM_TUNE` hashed the governed
tune, so each step of the scene governor (at most every 400 ms under load) re-keyed every kept
building and camp, and a machine near 30 fps lost kept arms when it needed them. It now hashes the
tune before the governor (`TUNE_BASE`): none of the five values the governor scales is read inside an
arm on the GL path. `STEP=33 npm run perf:armkeep` flies at an apparent 30 fps and matches the live
draw over 240 frames; residential cockpit went from 417 kept and 417 replays to 176 kept and 48,318.

**Camps** (`campKeep`, `campKept`). A camp's record list was already camera-free; its records are now
grouped by facing condition, each group recorded once while the camp stands well in front, and each
frame only the condition is tested. Close to, a camp runs as before (campReplay clips at the near
plane on the CPU). Kept camp records go through the ordinary stream, not as retained groups: a
retained group is a draw call per texture, and a camp is a hundred small groups. Halcyon cockpit:
drawTentCamp 1.67 to 0.65 ms headless.

⚠ **Kept buildings are retained groups, one draw call per building per texture** (gl/decals.js
`spans`). Nobody has counted those draw calls in a browser. If the cockpit shows a driver cost, sort
the arena by texture so neighbouring spans merge.

**Posed instruments** (interior-memo.js `memoPosed`, interior-kit.js `posed`/`posedRot`,
`setInteriorPose`). A needle, a compass card, the attitude's bank scale and the Mule's control
wheels are built once at rest; each frame the same face objects come back with their points moved
through a rigid transform and `mv` bumped, so `cabFace` keeps its record and gl/solids.js re-sends only
the moved slots (`slotV`). In a memoised part the kit builds fresh, as before. Mule cockpit in flight,
interior headless: 3.9-5.2 to 1.6-2.4 ms. Against the previous code, every interior record matches
over 40 moving frames except the wheel's rods, whose facets now turn with the wheel instead of
being re-chosen from world axes each frame. ⚠ A `shellFaces` result is good until the next call;
a gate that keeps one copies it (`freezeFaces`).

## Measured and built 2026-10-06

**The last GPU syncs on the frame path.** A query probe in the Modelshop (wrap `getParameter` and
`isEnabled`, paint, count by caller) found three left, each a round trip that drains the command
queue:

- The cabin's shadow pass (gl/solids.js `shadowPass`) read the framebuffer, viewport, scissor and
  blend on every frame a cockpit or cab was in view. Its two callers in context.js now pass the
  target they know (`frameTarget`).
- The murmuration step (gl/murmur-gpu.js `withState`) saved and restored eleven pieces of state per
  frame while a flock was in view. The world pass passes the canvas size and the step hands back the
  state the probe found on entry over 80 frames. `step()` on its own still saves and restores.
- The boat chase's split floor (gl/world.js) read the viewport that `draw()` had just set.

A cab or cockpit frame now makes no state query. The murmuration cockpit shot, HEAD against the
change in a detached worktree, differs on 2 of 518,400 pixels, the same as either build against
itself.

**Phase 6, the cheap half: occluder geometry kept per building** (`occCache`, `OCC_GEOM`). The
hull, roof and solid boxes are built once per cell in the building's own frame and each frame only
moved by the camera offset and projected. Each rotated term is stored as the old code computed it
and the offset added in the old order, so `perf:exact occCache` is identical over 60 views (and
fails 50 of 60 with the boxes deliberately made taller). Headless, `world:occlude` in the Halcyon
cockpit went from about 2.6 to 2.0 ms; in a cab it's within noise. What's left is projection
(`boxQuads`, about 0.6 ms) and the depth raster (about 0.5 ms). From the air the pass culls nothing
at all, but its field still serves `decoHidden` and the own ship's mask.

`bldgSlug` (glass/model-registry.js) is memoised: `modelFor` slugged the building's name with a
regex several times per building per frame.

### Where a steady cockpit frame goes now

⚠ **`scene.mjs` builds a new map array on every `view()` call**, and `groundLUT`, `footfallFill`
and the flock search cache on the map array's identity, so a headless loop that calls `view()` per
frame measures them missing every frame (about 9 ms of a 45 ms frame that the game never pays).
Build the view once and spread it per frame: `const v0 = view(place, seat); paint({ ...v0, heading })`.
The same goes for spinning the heading 12° a frame: kept arms only record a building well in front
of the eye, so a fast spin keeps them probing. Turn about a degree a frame.

Headless, Halcyon cockpit at noon, persistent map, 1° a frame, about 22 ms (node runs about twice
the browser). `drawWorldObjects` is 19.7 ms of it, and the tail is flat:

| what | ms | note |
|---|---|---|
| live building arms | 2.7 | kept replays cost 0.09; the rest is buildings with moving parts: the clone facility (0.44), rings (`drawRing`, `revolveRing`), KSAB, the ATC tower, the lighthouse |
| the cockpit interior | 2.6 | `muleFit` re-lays every dial each frame (0.8); `pushInteriorShell` and `cabFace` the rest |
| tent camps | 1.7 | `campReplay` replays records but still pulls and back-face tests them per frame |
| the South Lock | 1.0 | |
| cliffs | 0.95 | |
| cloth | 0.8 | |
| occlusion | 2.0 | after `occCache` |
| sweep, inline | 3.3 | the tile loop over 73×73 tiles and the arms dispatch |

So the next steps, in order of what they buy: split a building's moving part from its kept part
(phase 5's next step, below), draw instrument needles as transforms of cached parts, and put camps
on the kept path the arms use.

## Measured 2026-10-01: garbage is the tail

On a quiet machine (an RTX 2070 SUPER, under 25% CPU), a headless V8 allocation profile of the GL
path over Halcyon put the frame at **12 MB allocated in the cab and 23 MB in the cockpit**. The
collector ran every few frames, and that's where the long frames came from: the dearest item moved
between runs (bays one run, the yacht the next, redrock the next) because a GC pause landed in
whichever item was running. The allocation was spread over dozens of sites, the largest being the
ground surfaces at about 3.5 MB a frame.

Plain frames at Halcyon, pinned dials: the cockpit went from 88 ms in the morning to 38.9 ms
(bench) by the end of the day; the cab from 26 ms to 15-29 ms. Neither is at 16.7 ms.

## Built 2026-10-01

Each is behind a `RENDER_TUNE` switch (0 is the old path) and was checked against the old path:

- **Own ship in its own frame** (`glShipLocal`): local points, local normal, the sun term in the
  shader; one matrix a frame and an incremental upload. Pixel-identical on an empty map.
- **Cockpit interior** records reused; the seat attitude applied in the vertex shader (`seatAtt`).
- **Ground tiles** (`groundCache`): a road tile's GROUND_MESH records recorded once and replayed;
  kerb lines rebuilt from their ends. A tile that touches the canvas, queues ground-late work or
  pushes to another sink is never replayed, and a tile has to record the same twice before it is.
  Every record matched within 1e-12 over 20 views.
- **Flat-only detail kinds** (`flatSkip`): 22 kinds that only lay flats the mesh already holds are
  skipped on the GL path. Identical sinks and canvas calls over 60 views.
- **Decal fills** (`decoFast`): the `signSquare` pull done in world space. Exact over 9,083 calls.
- **Cliffs** (`cliffCache`), **camps**, **hoodoos**: recorded or replayed in the map window's frame.

Later the same day, each exact over the 60 views of `perf:exact`:

- **Cockpit faces by slot** (`cabSlot`): a face at the same slot as last frame, under the same
  profile and trim, pushes last frame's record without asking `CAB_GPU`. One shared world-points
  getter (`cabGetter`): a getter per record put every record after the first in V8's dictionary
  mode, so every read of one was a hash lookup.
- **A flock's ledge pool** (`perchMemo`): kept per map window; only the landing pick reads the
  clock. A hawk asked for its pool seven times a frame over 169 tiles, 1.5 ms of a cockpit frame.
- **The depot's shell** (`bayCache`): recorded once per key (window position, day or night,
  inside or out, the door, alpha) and its records replayed; the floor legends, lights and lettering
  stay live.

Browser bench at Halcyon (`__glWhere`, best of three): the cockpit went from 38.8 to 29.0 ms and
the cab stayed at about 15.5 ms. Headless allocation: cockpit 24.7 to 21.9 MB a frame,
residential 20.0 to 17.1.

Then the GL uploads, where the browser showed the cockpit's world solids at about 6 ms:

- **The vertex writers** in gl/solids.js and gl/ground.js read each record once instead of four
  times a vertex (records come in a dozen shapes, so each read is a megamorphic lookup), and the
  ground writer stopped making a closure per quad. Byte-identical buffers over 72 and 64 frames
  against the committed files under a fake GL. Node, Halcyon cockpit: world solids 1.6 to 1.1 ms,
  the cab interior 1.0 to 0.5, ground 1.9 to 1.4.
- **Retained groups** (`glRetain`): an array of records the caller hands back unchanged
  (`bayGroup`: a depot's shell, a hoodoo tile) is written once into a second buffer and drawn from
  there. The same triangles as before over 120 frames under a fake GL, once each view had been
  painted once (a first paint at a new view draws more, retained or not). About 1,700 of 3,000
  bay-sink records a frame, two new arrays a frame while turning. World solids 0.95 to 0.74 ms in
  node; what's still sent every frame is the statue (shaded by the view direction on the CPU) and the
  canal locks (normals flipped toward the eye, a flashing signal). Both need that shading in the
  shader before they can be retained.
- **Hoodoos were fogged twice** (`hoodooStable`): the CPU fogged their colour and the solids shader
  fogged it again, since they moved from the decal layer (no fog) to the solids layer. Now the
  shader alone fogs them and every facet is sent, so a tile's records never change. This one moves
  the picture, on purpose: 0.1 to 1% of pixels at Halcyon, where spires are.

Tried and backed out: a retained layer for hoodoo solids. Their colour carries CPU fog by distance,
so most records changed every frame anyway (no gain, 46-55 ms against 47-48).

## Where the time goes

Measured in [glass-notes.md](../reference/glass-notes.md): a settled GL frame spends about 6.5 ms in
`world:build` and 3.8 ms in `world:arms` on the CPU, against 2.4 ms submitting (`world:gl`) and
0.7 ms occluding. `world:arms` is the model arms running every frame to collect adornments
(decals, strokes, sprites, billboards) for geometry that hasn't changed. Uploads aren't the cost;
building the records is. The worst arm is `shell_tower` at 0.52 ms a draw.

So the plan targets record building, not upload. The instanced layers already moved the animated
work to the GPU; what's left is static work repeated every frame.

## Stage 1: measure

**Started 2026-09-29; the baseline still has to be taken on real hardware.**

- Run `__glWheres` (tools/modelshop/districtcost.js) at every district landmark from a cab and
  from an aircraft, with `setWindshieldProfiler(true, { arms: true })`.
- Three runs each, keeping the minimum: the first run of a cold process is wrong (glass-notes
  "District cost bench").
- Record a per-district table of `world:build`, `world:arms`, the ten dearest arms and decal counts.
  That table is the baseline every later stage is judged against.

What the first attempt found (in a cloud container, SwiftShader, no GPU):

- **The bench was measuring a collapsing frame.** It set `RENDER_TUNE.resFloor`, which nothing
  reads (the renderer takes `v.resFloor`), and sized only the canvas's holder, so each frame read
  the last one's backing size as its CSS size and shrank it: 448 px wide, then 314, 220 … 15×9
  over one run. Every figure it printed before this was taken at that resolution. Fixed.
- **The frame synced with the GPU process every frame.** The sky pass saved and restored its state
  with `getParameter`/`isEnabled`, and the first such query drains every queued command before
  it answers. In a CPU profile it was 56-87% of the frame; the mirror and the cloud volume did the
  same with one query each. All three are gone (the sky hands the context back at WebGL's defaults),
  and the picture is pixel-identical over three scenes.
- **SwiftShader can't say what that bought.** At full resolution its frames are 500-950 ms of
  software rendering, and removing a sync point just moves the wait to the next one (`world:gl`
  went from 5-450 ms to 5-915 ms with the total unchanged). On a real GPU a forced sync costs a
  command-queue drain, typically a millisecond or two, and stops the CPU and GPU overlapping.
  Measure it there.
- **The CPU phase timers are usable anywhere** (they time JavaScript, not the GPU): `world:build`
  11-20 ms and `world:arms` 2-15 ms per district at 640×360 here, noisy between reps. Residential,
  nightlife and civic are the dearest; the docks are cheapest.
- The remaining per-frame sync is in `gl/murmur-gpu.js`, which saves and restores about ten pieces
  of state with `getParameter` while a murmuration is in view. Same fix, not done yet.

## Stage 1b: an allocation budget

**Built 2026-10-01.**

Frame time on a shared machine swings 3x between runs; bytes allocated per frame don't. So the
measure that later stages are judged on is allocation, taken headless.

- `npm run perf:alloc` ([scripts/perf/alloc.mjs](../../scripts/perf/alloc.mjs)) paints real
  Coldwater headless with the GL path on (a stub hook that reports a canvas, from
  [scene.mjs](../../scripts/perf/scene.mjs)) under V8's sampling heap profiler with collected
  objects kept. `--detail` lists the top allocating functions; `--tune groundCache=0` measures one
  switch. It's a gate in the `shapes` group: MB per frame against `scripts/perf/alloc.json`, failing
  a rise over 10%. Run to run it moved under 2%. Baseline: Halcyon cab 12.9, Halcyon cockpit 24.7,
  residential cockpit 20.0 MB a frame. With `groundCache` and `flatSkip` off it fails by 29-40%.
- `npm run perf:exact -- <tuneKey> [off] [on]` ([scripts/perf/exact.mjs](../../scripts/perf/exact.mjs))
  paints 60 views (5 places, cab and cockpit, noon and night, 3 headings) with a switch off and on
  and compares every sink (sprites, strokes, decals, scatter, ground, bay, curtain, ship) to 1e-9
  and every canvas draw with its path, style and transform. `groundCache`, `flatSkip`, `decoFast`
  and `itemPool` pass; `roadArc 1 0` fails, as it should. About 14 s.
- ⚠ The DOM stub hands out a fresh 2-D context per `getContext`, so a cache keyed on a context
  (bakeQuadTex) misses every time headless. A top allocator that's a bake is that, not a finding:
  check it in the browser before chasing it.

## Stage 2: cache each building's adornment output

- Record the records an arm pushes (decal, stroke, sprite and billboard, all in world space) the first
  time a building is drawn, and replay them on later frames instead of running `drawTypeModel`.
- Key on appearance, never the camera (glass-notes "keyed on appearance"): building id, detail tier,
  LOD rung, a quantised night/light band, and the power inputs (`glPowerForCell`).
- ⚠ **The records themselves can't be cached.** Every emit primitive is camera-dependent: decal
  corners are pulled toward the eye along the view ray (`cam.unproj`), wires are clipped at the near
  plane, sprite sizes are pixels chosen from distance, and all coordinates are relative to the
  camera. What can be cached is the CALLS (primitive plus world-space arguments), replayed through
  each primitive's tail. That saves the arm's own logic and keeps the projection cost, so measure
  how much of `world:arms` is arm logic before building it.
- An arm that reads `now`, the camera or `cam.unproj` (`emitDecoQuad` does) is uncacheable. Mark it,
  or split it so only its live part runs each frame. Flags, signs that flicker and anything using
  `motionOn` fall here.
- (2026-10-01) The decal pull doesn't need the projection: with `signSquare` it's one fraction of
  every corner's depth, a uniform scale about the eye, so a replayed decal call can compute its
  corners from the depths alone (`campFillFast`, and `emitDecoFill`'s fast path, both exact). Wires
  and sprite sizes still need the camera.
- (2026-10-01) Detect, don't predict: the ground cache marks a tile dynamic if it touched the canvas
  or another sink while recording, and requires two matching recordings on different frames
  before it replays (that's what caught clock-animated ground marks). Do the same per building.
- Invalidate on a tier change, a light-band change, a content change to the cell, or an LRU limit.
- Start with `shell_tower`, then the dearest arms from the stage 1 table.
- Behind `RENDER_TUNE.armCache`; 0 is today's path. A/B with a Modelshop pixel diff at every
  district: the picture must not move.
- (2026-10-01) Measured before building it, per item with the arms profiler: building arms are
  3.2 ms of a Halcyon cockpit frame (205 runs at 16 µs) and 6.3 ms of a cab frame (107 at 59 µs),
  spread thin: the dearest callees are `detailLayer` (2 ms, no painter over 0.6) and authored
  models (1.4). Marks, the cockpit itself and the birds cost as much and were cheaper to fix, and
  were fixed first (Built, above). What's left in the cockpit is as much the GL upload as the arms:
  `uploadSolids` re-sends all ~3,000 world solids every frame (no model matrix, so no incremental
  mode), and fewer than half are the same record at the same slot as last frame, because hoodoo
  records rewrite their fogged colour in place and the count moves with the heading.

## Stage 3: the city stays on the GPU

**Plan, 2026-10-02. Phases 1 to 5 built; phase 6 to do.**

Phase 5, as built (`armKeep`, `drawTypeModelKept` in windshield.js): with the mass on the GPU, a
building's arm output is recorded and, once proven, replayed as retained groups. Keyed on the
building's window position, tier, front facing, night, fade, power and dpr. Proven means: two
recordings at camera poses at least `ARM_GAP` frames apart and visibly different came out the same
in the window frame, plus a shadow run with `now` moved by 1.2 s that came out the same too (a slow
blink can match itself twice). Recorded only while the building stands well in front of the eye and
with `decoHidden` off, so a kept set holds every part. A canvas call, a 2-D closure, a push to any
other sink, a ground-late job or a rain light marks it live. Kept sets are shifted each frame by the
change in `ox`/`oy` (cheap; the CPU readers stay right) and re-recorded every `ARM_RECHECK` frames,
two a frame. `npm run perf:armkeep` (scripts/perf/armkeep-check.mjs) flies three places with it off
and on: no live triangle missing from the kept draw over 180 frames, and a 300-frame flight ran 101
rechecks with none dropped. Kept, headless: Halcyon cockpit at night 100 of 185 (neon flicker and
beacons keep the rest live), residential by day 63 of 63. Headless Halcyon cockpit: arms 11.9 to
8.7 ms, frame 20.8 to 17.2 ms. Not yet measured in the browser on a quiet machine.

(2026-10-04) Blinks moved to the sprite shader (`glBlinkGPU`): `blinkLight`'s record carries its
base alpha and `bl` = [0.4, 0.5, phase], the shader applies `0.4 + 0.5 |sin(t + phase)|` with `t`
the frame clock reduced mod pi on the CPU. Pixel-identical to the CPU blink in the browser with
frozen clocks. Halcyon cockpit at night: kept 100 to 165, live 85 to 19. What's left live is mostly
real motion: the Ascendant buildings' rotating rings and moving lines (tag `moving`), the
nightclub's moving lights and the lighthouse beam, which want a rotation in the vertex shader.

Next for phase 5: a building with one moving part goes wholly live. Splitting an arm's live part
from its kept part (the plan's "a building with any of these keeps a live part beside its retained
part") would keep most of the 85 at Halcyon by night.

Phase 4, as built: gl/retain.js (`createArena`) is the solids' retained buffer in general form, and
the sprite, stroke and decal layers each keep groups in it: sprites by blend mode (two arenas),
strokes as glowing cores, plain cores and haloes (three, the first also in the depth prepass), decals
one arena drawn per group-and-texture (`spans`), with kept textures marked live so the cache can't
evict them. A sink hands groups over as `list.groups` (`{ recs, at, ox, oy }`, `splitGroups` in
gl/context.js). Nothing registers light, wire or decal groups yet; that is phase 5.
`npm run perf:retain` (scripts/perf/retain-check.mjs) marks chunks of real frames as groups, some
handed back across frames, and compares the triangles drawn with and without: 180 layer-frames
identical, and a dropped record fails every one. Allocation: phases 1 to 3 add 0.4 to 1.5 MB a frame
of raw-corner arrays, which go away when phase 5 stops rebuilding kept buildings.

Phase 3, as built (`glSizeGPU`): a decal can carry its raw corners (`rp`), the polygon it came from
(`rc`, whose centroid's depth is the mean the square pull uses, since depth is affine) and the pull
(`pl`); the decal shader scales about the eye by `1 - min(0.5, pl / depth(centroid))`. Set by the
`emitDecoFill` and camp fast paths, by `emitDecoQuad`, and by `emitSurfaceText`, which recovers the
raw quad itself as the zero-pull unproject of the caller's screen points (`fitSignPts` insets by
proportion, so it commutes with the scale), so no caller changed. `perf:sizes`: 95% of decals, every
corner within 2.3e-14 tiles. Browser, frozen clocks: 3 to 43 pixels in 400,000 against a noise of 2
to 38. What's left is signal-mast lenses and moving things.

Phase 2, as built (`windowFrame` in gl/context.js; the `setWindowFrame` switch went 2026-10-17): the sprite, stroke and decal layers add the
camera's `ox`/`oy` as they write and draw with the shifted camera, the solids' frame. The records the
CPU reads are unchanged (still the camera's frame), so a retained group (phase 4) converts at the
moment it's recorded. In the browser with frozen clocks, old frame against window frame differs on 0
to 4 pixels against a noise of 0 to 11. The decal lights (`pickLights`) were already in this frame,
so lit cloth was lit from up to a tile off; it now matches, though no view tried showed it.

Phase 1, as built (`glSizeGPU`): `pushLightSized` gives a light a size spec and the sprite shader
sizes it from `clip.w`, which equals the CPU's `f` exactly (checked over 6,237 lights). `emitWire`
hands the strokes shader its raw ends and the pull, and the shader pulls each end along its own ray.
Both keep the CPU numbers on the record for the CPU's readers. Converted: the depot lamps,
`glowPool`, `drawCityBloom`, `groundLamp`, `helideck`, `facadeLights`, and every pulled wire.
`npm run perf:sizes` (scripts/perf/sizes.mjs) recomputes the shader's numbers: 51% of lights and 98%
of wires, all exact to 1e-14. In the browser with frozen clocks, off against on differs on 10 to 27
pixels in 400,000 (32-bit floats on the GPU). Not converted: lights on things that move every frame
(steam, smoke, exhaust, birds, aircraft, the yacht, the freighter), and the depth-based widths of
signal masts and street lamps (`wPx(r0, r1, f)`), which are street furniture, not building arms.

### Why this and not more caches

Browser bench, Halcyon, quiet machine, 2026-10-02: the cab is 12.5 ms and the cockpit 26.2 ms
(build about 14.5, GL upload about 7.3). Every cache so far has kept the JavaScript that builds a
record and only stopped it being built twice. The cockpit has to lose about 10 ms, and the arms
(7 to 9 ms) and the uploads (7 ms) are most of it. Neither goes away while every adornment is
rebuilt and re-sent each frame because its numbers depend on the camera.

So the goal: **a building's adornments are built once, in the map window's frame, uploaded once, and
drawn by the GPU from any camera.** The CPU's per-frame work becomes "which retained groups are in
view", not "what does each one look like from here".

### What makes a record camera-dependent today

Each of these has to move into a shader, or into a cache key, before a building can be retained:

| Dependence | Where | Where it goes |
|---|---|---|
| Coordinates relative to the camera (`dx`, `dy`) | every sink except solids and ground | records in the map window's frame; shaders take `camAt` like solids do |
| Pixel sizes from distance (`clamp(k / f, lo, hi)`) | 23 `pushLight` sites, `pushStroke`, glow helpers | record `k`, `lo`, `hi`; the vertex shader sizes from `clip.w` and `uDpr` |
| The decal pull toward the eye | `emitDecoFill`, `emitDecoQuad`, `emitSurfaceText` | record raw corners and the pull; the shader scales about the eye by `1 - min(0.5, pull / meanDepth)` (exact, see `decoFast`) |
| Screen-point inputs (`emitSurfaceText`, `emitDecoQuad` take projected corners) | signs, lettering | take world corners instead; the projection was only used to unproject again |
| Near-plane clipping on the CPU | `emitWire`, `campClip` | the GPU clips; a segment crossing the eye plane is the one case to test |
| Culls on distance or facing (`p.f > 0.12`, `frontVis`, back-face tests) | most arms | facing goes in the cache key (it changes rarely); distance culls move to the shader as a fade; back faces are depth-hidden |
| Detail tier by distance (`ADORN_TIER`, `webBays`) | `drawTypeModel` call site | a cache key: one entry per tier, switched as the building crosses a ring |
| CPU fog in a colour | hoodoos (fixed), statue, locks | the solids shader's fog |
| View-dependent shading | statue, canal locks | port to the solids shader, or leave them live (they're two items) |
| The clock (`now`, flicker, blink, flags) | some signs, beacons, flags | leave live: a building with any of these keeps a live part beside its retained part |

### Phases

Each phase ships behind a `RENDER_TUNE` switch, with `perf:exact` or a fake-GL triangle check
proving it draws the same, and the browser bench before and after.

1. **Sprite and stroke sizes in the shader.** `pushLight` and `pushStroke` take a size spec
   (`k`, `lo`, `hi`) as an alternative to a pixel size; convert the helpers first (`glowPool`,
   `blinkLight`, `groundLamp`, `emitLightRunner`, `emitWire`), then the direct arm calls. Check:
   sizes match the CPU numbers to a pixel over the 60 `perf:exact` views. No speed gain on its own.
2. **Map-window frame for sprites, strokes and decals.** Same as the solids already are. The layers
   take `camAt`. Check: fake-GL screen positions match to 1e-6.
3. **Decals: raw corners, pull in the shader, world-space lettering.** `emitSurfaceText` and
   `emitDecoQuad` get world-corner entry points. Check: `decoFast` is already the exact reference.
4. **Retained groups in every layer.** Generalise `retain()` (gl/solids.js) into the stream helper
   so sprites, strokes and decals keep groups the same way. Check: the fake-GL triangle comparison,
   extended to those layers.
5. **Retain building arms.** Record each building's sink output once per key (building, tier,
   facing, night band, power state) into groups. Detect rather than predict, as the ground cache
   does: an arm that reads the camera outside a converted primitive, touches the canvas or reads the
   clock is marked live and runs every frame as now; a key must record the same twice before it's
   kept. Gate: the share of arms retained per district, which should rise as stragglers convert.
   This is where the arms' 7 to 9 ms goes.
6. **The occlusion pre-pass** (about 2 ms): with buildings retained, cache each one's occluder
   corners per map window, or cull against last frame's depth.

### Expected result, and the risk

If phases 1 to 5 retain most buildings, the cockpit loses most of the arms and the uploads of what's
retained: an estimate of 10 to 12 ms, which is the gap. The risk is the long tail. Some 170 arms
call primitives in their own ways, and every one still reading the camera stays live. Phase 5's gate
says how far the tail goes before the work is done, so the order is chosen to pay back at every
phase from 4 on rather than only at the end.

Out of scope: ground (already cached per tile), clouds and billboards (they need their sorts and
fades moved off the CPU first), the cockpit interior (already incremental).

## Also measured, not yet staged

- **The occlusion pre-pass** (`world:occlude`): the geometry is kept per building since 2026-10-06
  (above). What's left is projecting the boxes and rasterising them; culling against last frame's
  GPU depth, read back small, would replace both.
- **Cockpit instruments** rebuild their kit parts whenever a needle moves (`interior-kit.js`
  `plate`, about 0.4 MB a frame while turning). Draw needles as transforms of cached parts.
- `scripts/shapes/glstream.mjs` scans for layers uploading the old way. A retained range must pass it
  or be added to it deliberately.

## Leave alone

- **Ground buffer caching** was measured at 0.00 ms and rejected (glass-notes "Ground buffer
  caching (not done)").
- **Strokes** are about 1,500 a frame in one draw call and measured not to be a bottleneck (glass-notes
  "Truss web LOD").
- **The cloud sort** stays: the cards are translucent and need far-first order.

## More vertex animation, if there's still work

- Traffic, if cars start rebuilding geometry per frame (not checked).
- Rotors want a rotation uniform rather than a baked texture, and smoke and fire want GPU particles.
  Neither is a vertex-animation fit.
