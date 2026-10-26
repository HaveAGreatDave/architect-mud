# GLASS frame headroom

**Status: Stage 1 started (the bench fixed, per-frame GL state queries removed); the 2026-10-01 record caches built (below); Stage 1b built; Stage 3 phases 1-5 built, phase 6 started, kept-arm follow-ups built (2026-10-06 and 07, below); kept arms made to work for a moving camera (2026-10-19, below); flat decal fills batched (2026-10-19, below); the caches keyed on the map window made to survive a recentre (2026-10-19, below); Stage 2 superseded by Stage 3; a still camera keeps (2026-10-24, below); armChunk measured and not built (2026-10-24, below); the live arms and marks profiled, two exact cuts built (2026-10-24, below); buildings in the haze band keep (`armFade`, 2026-10-24, below); the lock, AA, media lot and statue shaded on the GPU and kept (`marksGPU`, built 2026-10-24, on since 2026-10-25, below); why `world:gl` rose with it found and fixed (2026-10-25, below); kept strokes that cross the eye plane run live (`armNearWire`, 2026-10-25, below); `cssRgb`'s double lookup measured and left (2026-10-25, below); the GL canvas hands each pass over, which took the ~1 ms off the cabin's copy (`glTransfer`, 2026-10-26, below); the occlusion pass skipped from the air on GL while nothing on the canvas asks for it (`occAir`, built and off, 2026-10-26, below); the ~1 ms at the sky strip traced to the frame boundary (2026-10-26, below); the 2-D frame drawn off the page and handed to it as a bitmap (`wsHandover`, on since 2026-10-26, below); the scatter, cliffs and plateaus off the side of the canvas skipped (`sideCull`, built 2026-10-26, on since 2026-10-26, below), and the order-dependent scatter card fixed for it (`bakeTileFree`, on).** The vertex-animated layers it follows from are built (actors,
birds, cloth; see [glass-notes.md](../reference/glass-notes.md#vertex-animated-layers-actors-birds-cloth)).

## Built 2026-10-26, on: the ground's dressing off the side of the canvas (`sideCull`, `bakeTileFree`)

David saw the `bakeTileFree` shots and turned both on (2026-10-26).

The lateral cull (`offCanvasLaterally`) only ever skipped buildings. Every other tile off the side of
the canvas still ran its drawer: the scatter, the cliffs and plateaus, the marks. With
`RENDER_TUNE.sideCull` 1 (and `frustum`), a tile with no building, mark, road, Curtain or yard kit is
skipped too when it's wholly off the side. 0 culls buildings only, as before.

**What it cost.** The item loop's per-item timer (PERF.armv), split by whether the item was off the
side, a moving camera, 120 frames:

| route | non-building items off the side, ms a frame |
|---|---|
| Halcyon, cab | 1.49 |
| residential, cab | 1.65 |
| Old Coldwater, cab | 1.60 |
| Marrow, cab, night | 2.67 |
| Halcyon, cockpit | 2.53 to 2.91 |
| nightlife, cockpit, night | 6.1 to 6.2 |

Most of it is the lock (0.5 to 1.5 ms) and the camps (about 1.0), then redrock (0.8), cliffs (0.55 from the
cockpit) and badlands (0.3 to 0.4). The cull takes the ground's share: off the side, Halcyon's cockpit went
from 2.91 to 1.51 ms and nightlife's from 6.14 to 4.13. In `npm run perf:move -- <place> <seat> --prof`,
`world:arms` over two interleaved pairs: Halcyon cockpit 8.79 to 7.24 and 8.10 to 6.29, Old Coldwater
cockpit 8.26 to 8.47 and 8.34 to 7.29, nightlife cockpit 2.67 to 2.49 twice, Halcyon cab 5.20 to 4.89
and 4.72 to 4.46. Paint medians move the same way but are noisier.

**How wide each kind is tested, measured.** Every record each kind pushed, over 32 flights (cab and
cockpit, noon and 22h, eight places), against its tile's centre. A billboard's pixel width counts at the
depth it's drawn. The scatter (redrock, badlands, scrub, ash, forest, parkland, park, and wild tiles)
stays within 0.98 tiles, so it's tested at the buildings' 1.0. Cliffs and plateaus reach 1.41, so 1.5.
Pixel-sized records, the lights, are 60 px at most, inside `FRUSTUM_PAD_PX` (96). The pad is widened by
the bank (`_frameBankPad`). The world is drawn rotated about the centre, so a 30° bank shows 47 px
more of it each side than a level canvas, which left 49 px of pad for a 60 px light. The building cull
still uses the plain pad.

**Left out, and why.** Marks reach too far or carry state from frame to frame: the lock reaches about
3 tiles, a berth's lines further, a camp's 7.7 (by its lights), and the AA's aim and a bay's doors are
remembered between frames, so a skipped draw would freeze them. Roads, the Curtain and a yard's kit are
out for the same reach reason (signal masts and wires cross tiles). The lock and the camps are most of
what's left (see the follow-up below).

**`bakeTileFree`, the older bug the proof found.** A scatter card is cached by a key with no tile in
it (`_bbCache`), but `drawWildScatter`'s hoodoo-patch branch read `MARK_TILE`. A card baked from a patch
tile came out as a lone mesa or nothing, and its spires went into the live bay and decal sinks at the
bake's stand-in origin, under the craft. Whichever tile baked a key first decided the card for the rest
of the session. With the cull on, a different tile bakes first, so the far cards changed. With
`RENDER_TUNE.bakeTileFree` 1 a bake never takes the branch (`BB_BAKING`); spires are for the near ring,
which never bakes. `sideCull` does nothing unless `bakeTileFree` is on, so it can't change the picture
by itself.

**Proof that it's exact.** `sideproof.mjs` (the session's scratchpad; not in the repo) flies a route
twice, the switch at 0 and 1 in separate processes, and compares each frame's GL records as multisets
and the canvas log draw by draw. A record only at 0 must lie wholly off the canvas in that frame's own
projection; a canvas draw only at 0 must too, by its path's x extent. Canvas draws that differ only in
state they don't read (a stroke's `fillStyle`, or `globalAlpha` left set by a skipped tile and never
set by the other run, which a real canvas reads as 1) are the same draw. With `bakeTileFree` on in both:

- 24 runs: Halcyon, Marrow, nightlife, residential, Old Coldwater and the South Lock (911,926), cab and
  cockpit, noon and 22h, 24 frames moving and turning 1.5° a frame, plus nightlife's cockpit over 40.
  Up to 75,791 records dropped a run; none touches the canvas, none is added, and no canvas draw on
  the canvas differs.
- Banked 30° and −45° from the cockpit over Halcyon, nightlife and Old Coldwater: the same.
- The 0-against-0 control is identical, records and canvas.

`bakeTileFree` on its own, in the Modelshop with real WebGL2 at 936,924 in the Scarletwastes (one page
load per value, as the card cache can't be cleared from outside). Cockpit noon 0.001% of pixels against
a 0.002% control, the cab 0.000% against 0.000%. Cockpit night is 0.248% (worst 11 levels) against
0.004%. Those pixels aren't the redrock: they're the sparkle of the lights on the Curtain road and the
wall's stripes. The likeliest cause is the pinned random sequence landing differently once the bake
stops drawing spires; not traced. Headless, the far cards' records differ in where the card sits in the
atlas, not in what's drawn. Shots and numbers are in `.claude/shots/bake-tile-free/` (not tracked).

**On since 2026-10-26.** Both default to 1. `bakeTileFree` was built at 0 because it moves pixels;
it went on after the shots above. Setting `bakeTileFree` back to 0 also turns `sideCull` off.

**Follow-up: the lock and the camps off the side.** They're most of what's left off the side: 0.5 to 1.5 ms
and about 1.0. Culling them needs each one's reach measured (the lock about 3 tiles, a camp 7.7 by its
lights) and an audit of the state its drawer keeps between frames, so a skipped frame doesn't freeze or
jump it.

## Built 2026-10-26, on: the 2-D frame handed to the page as a bitmap (`wsHandover`)

The fix the next section points at. With `RENDER_TUNE.wsHandover` 1 (the default since the same day) a
view's frame is drawn into an `OffscreenCanvas` the page canvas's size, and handed to the page canvas
through a `bitmaprenderer` context (`transferFromImageBitmap`) in a microtask at the end of the task
that drew it (`handoverFor`, `handoverQueue` in windshield.js). 0 draws on the page canvas as before.

**Only a canvas on screen at its first paint is handed over** (`handoverOnScreen`): its box inside
the viewport, and seen (`checkVisibility`, with visibility and opacity). A canvas nobody sees isn't
presented, so there's nothing to save. That rule is what keeps the rest working without being told:

- The Modelshop's benches put their canvas off the page (`left:-10000px`), paint in a synchronous loop
  and read it back with `getContext('2d')` straight after. They stay on the plain path. Checked with
  the switch on: an off-page canvas painted three times gives a '2d' context with the whole frame in
  it. The two benches that put their canvas on screen (`paintMirrorShot`, `runPowerShot`) only show
  it, and show it correctly handed over.
- The cab's rear camera (`cab-rear`) is `visibility:hidden` with a real box, and `drawCabMirror` reads
  it back as an image in the same task, before a hand-over would land. It stays plain.
- A page with no window (a hidden Browser pane reports a 0x0 viewport) hands nothing over.

⚠ **`windshieldContext(id)` returns null before the view's first paint with the switch on.** A first
version fell back to `getContext('2d')`, and asking that early took the canvas's one context and
fixed it on the plain path (found when a check asked before the cab had painted).

**What else touches the page canvas, checked first.**

- Inside windshield.js, `paintWindshieldFrame` is the only place that takes the page canvas's context.
  It reads its own frame back three ways (the sky strip, the heat shimmer and two `ctx.canvas`
  self-copies), and those now read the frame being drawn (`FRAME_CV`, or `ctx.canvas` itself).
  `GL_HOST` is still the page canvas, and the GL pass only reads its size.
- Of the eight seat views that call `paintWindshield` (boat, cab and its mirror, cockpit and the
  Drake, free look, hangar seat, helm, podracer), only cab-view draws on the page canvas itself: the
  rig overlay (`drawRigOverlay`) and the road film (`drawRoadFilm`), after `paintWindshield` in the
  same task. They now ask `windshieldContext(id)`, the frame's own context, and go over with it. The
  other `getContext('2d')` calls in the seat files are other canvases (the GPS app, the PFD, gauges,
  MFD, the hangar stage). The flight drug effects only set CSS on the element, which works the same.
  The feedback telemetry only lists canvases by id.
- The Modelshop's benches take `getContext('2d')` on their canvas and read pixels back. A canvas has
  one kind of context for its life, so the switch is decided per element at its first paint: one
  that already has a '2d' context stays on the plain path, and one that took the bitmaprenderer keeps
  it even if the switch goes back to 0. The benches that read back after painting without taking a
  '2d' context first are off the page, so the on-screen rule above keeps them plain.
- `windshieldContext` is a new export, so `windshield-lazy.js` is re-baked (`npm run
  client:bake-lazy`; it also picked up a peer's uncommitted `berthServiceOpen`, which the check needs).

**The picture is the same.** Modelshop, real WebGL2, 1280x720, Halcyon, clock, date and random
pinned, 16 settle frames with the clock held still, read back by drawing the page canvas itself.
Each value needs its own canvas, so the control is a second plain canvas with its own view state:

| | 0 against 0 | 1 against 0 |
|---|---|---|
| cab noon | 0.003% (worst 6) | 0.003% (worst 6) |
| cab night | 0.000% (worst 6) | 0.001% (worst 6) |
| cab rain | 0.003% (worst 4) | 0.002% (worst 4) |
| cockpit noon | 0.025% (worst 33) | 0.002% (worst 14) |
| cockpit night | 0.006% (worst 8) | 0.004% (worst 8) |
| cockpit rain | 0.001% (worst 25) | 0.000% (worst 19) |

The shots are in `.claude/shots/handover/` (not tracked), with `diffs.txt`. Headless, Node has no
real bitmaprenderer, so every view takes the plain path: `perf:exact wsHandover 0 1` is identical over
60 views, and `shapes:smoke`'s first gate, the parse smoke, `imports:smoke`, the big-screen smoke and
the lazy-facade check pass.

**Measured live** (Browser pane in view, `requestAnimationFrame` running, a visible 1280x720 canvas per
value, Halcyon cab, 13h, rain). Phases of 20 frames, alternating three canvases (two plain, one
handed over) six times over:

| | strip read (median) | gap after the script (median) | paint (median / mean) | paint and gap (mean) |
|---|---|---|---|---|
| plain P | 1.90 ms | 0.50 ms | 22.3 / 26.6 ms | 27.1 ms |
| plain Q | 1.80 ms | 0.40 ms | 25.4 / 28.9 ms | 29.5 ms |
| handed over | 0.10 ms | 0.50 ms | 23.1 / 24.3 ms | 24.8 ms |

The strip's read falls by about 1.7 ms and nothing grows to take it back: the gap after the script,
which now includes the hand-over's own microtask, is the same. The whole-frame numbers are noisier
than that (the two plain canvases differ by 2.4 ms on the mean). An earlier run of three alternating
pairs of 60 frames gave the strip 1.3-1.7 ms against 0.1 and the gap 0.4 against 0.5.

**The cab seat, checked with the switch on.** `openCab` in a scratch page served from `client/` (the
seat harness in the memory notes), Halcyon, `grime` 1, with a timer standing in for
`requestAnimationFrame` and a 1280x720 viewport, because this session's pane had no window. The cab's
canvas took the hand-over (`windshieldContext('cab')` is the `OffscreenCanvas`) and `cab-rear` stayed
plain. The road film's draws all went into the off-page frame (4 in three seconds of throttled frames,
none on the page canvas). A test patch drawn through `windshieldContext('cab')` at the end of the
frame's task, where `drawRigOverlay` draws, is on the presented canvas (pixel 255,0,255) and gone the
frame after it stops. The rig overlay itself (`JACKKNIFING`) needs a jackknife, which the harness
can't set up; it's the same call in the same place. The scratch page is deleted.

## Measured 2026-10-26: the ~1 ms at the sky strip belongs to the frame boundary

`captureSkyStrip` draws the top band of the 2-D frame into a 256x128 canvas for the puddles and the
sea to reflect (only with wet ground or water in the window). In the `glTransfer` benches that
`drawImage` cost 0.6-1.6 ms. It's the frame's first read of the 2-D canvas, and that's what costs.
Modelshop, Halcyon cab, 13h, rain, 1280x720, 12 ms idle between frames:

- **Moving the read moves the cost.** A 1x1 read of the 2-D canvas just before the strip costs 0.74
  ms and the strip then 0.00. With no strip (`glMirrorSky` 0) the end-of-frame read pays it instead
  (0.13-0.19 to 0.87 ms). All the copies plus that read come to about the same either way.
- **It isn't the sky's drawing.** A read at the very start of the frame costs 0.005-0.015 ms. With
  every fill, stroke and text before the strip skipped (a measuring hack), the strip still costs 0.94.
  The same kinds of draw on a fresh canvas (full-screen gradients, 40 radial gradients, ridge polylines,
  a 1280x720 GL bitmap) flush in 0.12-0.16. The real canvas is accelerated (default attributes,
  `willReadFrequently` false) and does the same synthetic draws in the same time.
- **It isn't the GL sky either.** With `glSky` 0, so no GL bitmap reaches the 2-D canvas before the
  strip, it's 0.72-0.81. A `gl.finish()` first costs 0.005-0.01 and changes nothing.
- **It's the previous frame being held.** Without the 1x1 read at the end of each bench frame (which
  stands in for the browser's commit), the strip costs 0.075-0.085 ms. With it, 0.82-0.90. So the
  first read of a frame pays about 0.8 ms to keep the last frame's snapshot whole, and a full-canvas
  overwrite first (a `copy` fill, a full `clearRect`, `ctx.reset()`) doesn't avoid it (0.72-0.97).

So there's nothing to fix in the strip: dropping it, moving it or flushing early only moves the cost
to the next read, and the picture can't stay the same without it. The bench numbers above for
`glTransfer` and `occAir` all include this cost in their "end flush" column.

**And the game pays it (measured live the same day, Browser pane in view, `requestAnimationFrame`
running at 30-45 a second).** A visible 1280x720 canvas painted by `paintWindshield` each animation
frame, Halcyon cab, 13h, rain, 60 frames a phase, alternating. The gap is from the end of the frame's
script to the next task, which is where the browser's own rendering and its commit of the canvas run:

| | strip read (median) | gap after the script (median) |
|---|---|---|
| strip on, round 1 | 0.90 ms | 0.60 ms |
| strip off, round 1 | none | 1.30 ms |
| strip on, round 2 | 0.80 ms | 0.50 ms |
| strip off, round 2 | none | 1.20 ms |

With the strip off the cost moves into the browser's rendering step, about 0.7 ms more, so it's a
cost of presenting the 2-D canvas, every frame, whatever the strip does. A standalone loop with the
same kind of frame (full-screen gradient, 40 radial-gradient ellipses, a ground fill) shows it and
shows the fix:

| | first read | gap after the script |
|---|---|---|
| visible 2-D canvas, with a read | 0.70 ms | 0.20 ms |
| `OffscreenCanvas` handed to a `bitmaprenderer` canvas, with a read | 0.00-0.10 ms | 0.20 ms |
| visible 2-D canvas, no read | none | 0.80 ms |
| `OffscreenCanvas` to `bitmaprenderer`, no read | none | 0.20 ms |

So the candidate fix is the one `glTransfer` used for the GL canvas: draw the frame into an
`OffscreenCanvas` and hand it to the visible canvas with `transferFromImageBitmap`, which saves about
0.6 ms a frame at 1280x720 (more at a larger frame). Not built: it changes how the game's canvas is
presented, so it needs a look at everything else that draws into or reads that canvas first, and its
own switch and shots.

## Built 2026-10-26, off: the occlusion pass skipped from the air on GL (`occAir`)

Phase 2's other half. The pass was kept on GL (see "the occlusion pre-pass still pays on GL", below)
because its field is the only thing keeping some canvas draws behind buildings. So the first question
was which canvas draws those still are.

**What the field still does for the canvas, measured.** Flown twice in separate processes, with
`occlude` at 1 and 0, comparing each frame's canvas draws as multisets (120 frames each: Halcyon
cockpit at 13h and 22h, still and moving; residential, nightlife, old Coldwater and Marrow cockpits
moving by night; a Halcyon cab):

- Nothing the field used to hide from the air draws on the canvas any more in most of it. The glows
  (`glowPool`) go to the sprite sink, the signs, flags, dishes and blades (`emitDecoQuad`) to the
  decal sink, the scatter (`groundHidden`) to billboards, and the depth buffer hides all of those.
  At Halcyon by day, still and turning, the canvas is the same on all 60 frames.
- **The wild scatter's mesa** (`drawMesaBB`) differs on a few frames, and it's invisible either way.
  In the near ring of a hoodoo patch, `drawWildScatter` skips its billboard and draws the mesa straight
  onto the canvas during the sweep, which is under the GL world image, so the opaque floor covers it.
  That's an older bug of its own: those mesas don't show on GL at all. Fixing it changes the picture,
  so it's left for its own switch.
- **Two kinds still need the field from the air:** the hangar's passenger lounge (`downtown.js`, an
  interior kept on the canvas because its own glass would hide it on the depth buffer, asking
  `markHidden`), and a landmark too near to bake (`markBillboard` refuses within 1.5 tiles, so the
  South Gate, a sign or the pylons fall back to the canvas through `markHidden` and `emitMarked`'s clip).
  Neither moves to a GL sink exactly. The lounge would need a pull in front of its glass, which
  changes how it sits against the glass; the near gate needs real geometry, not a card.

**The switch (`RENDER_TUNE.occAir`, 0; 1 skips).** With GL drawing the city and the eye at 0.25 tiles
or more (`OCC_AIR_EH`; a cab is 0.12), the pass runs as a probe. After a frame it ran in culled no
building, it's skipped for up to 10 frames (`OCC_AIR_EVERY`), and it comes back the next frame if
anything on the frame's canvas asks the field a question (`OCC_CANVAS_ASK`): a `decoHidden` from
anything but the two GL-only callers (`OCC_GLQ`), a `markHidden`, a contact's probe, or
`beginOcclusionClip`. Questions from a landmark's bake or a shape or mesh capture don't count: those
paint into canvases of their own. ⚠ **Counted as asked, not as hidden**: the first version counted
only what the field hid, and at nightlife the lounge then drew through a building on 10 skipped
frames. ⚠ **And so a canvas thing that comes into view in a skipped frame has one frame with no
field.** Per GL view (`GL_ID`).

Building culls by eye height (moving, Halcyon): 20 a frame at 0.2 tiles, 3 at 0.3, 0.4 at 0.4, none
at 0.5; residential 7 at 0.3, none from 0.4. Where it culls, the pass pays for itself: at Halcyon at
0.3 and 0.4 tiles the frame was 2.3 and 0.8 ms cheaper with it than without.

**Proof.** With `occAir` 1 against 0 over the same nine flights, the pass ran on 17-32 of 120 frames
from the air and 120 of 120 in the cab, and the canvas draws are the same on every frame except the
invisible mesa. Mutation: throwing the questions away (a temporary mutant) puts the lounge back on the
canvas on skipped frames at nightlife. `perf:exact occAir 0 1` differs on 4 of 60 views, all in the
decal list only (1 to 8 more records: deco quads the field culled, which the depth buffer now
hides), and `occAir 0 0` is identical. `shapes:smoke`'s first gate, the parse smoke and
`imports:smoke` pass.

**Cost.** It saves less than the pass costs, because what the field culled for the GPU now reaches it.
Headless (`perf:move --gl --prof`, three alternating pairs): residential cockpit, `world:occlude` 0.94-1.03
to 0.00 ms, the 200-frame total 4046, 4016, 4678 against 4029, 3967, 4250 ms (about 0.8 ms a frame).
At Halcyon on that route the lounge and the near gate keep the pass running on 52 of 120 frames, and
the pairs are inside the noise. In the browser (Modelshop, cockpit, 22h, four pairs at Halcyon and
two at residential) `world:occlude` falls from 1.2-2.1 to 0.1-0.5 ms, but `world:arms` and `world:gl`
take some of it back and the frame times are inside the noise (the Browser pane was hidden). So it
ships at 0: it's correct, and worth turning on only once the lounge and the near landmarks are off
the canvas, or for a phone where the pass's CPU matters more.

**Follow-up (not started; David, 2026-10-26: leave `occAir` at 0 until then):**

- The hangar's passenger lounge (`downtown.js`, `keptOnCanvas('departure-lounge')`) onto a GL sink,
  baked at the live camera and pulled in front of its own glass, behind its own switch with shots.
- The landmarks too near to bake (`markBillboard`'s 1.5-tile limit: the South Gate, road signs,
  pylons) onto the depth buffer as geometry rather than a card, behind its own switch with shots.
- Then fly `occAir` 1 against 0 again at Halcyon, where those two keep the pass on 52 of 120 frames.
- Separately, the near-ring mesa (`drawMesaBB` from `drawWildScatter`) onto the billboard path, so it
  shows on GL at all.

⚠ **Found on the way: the headless DOM stub's `OffscreenCanvas` passed for WebGL2.** It answers every
`getContext` with a 2-D stub, so with `glTransfer` on every headless `--gl` bench fell back to the 2-D
renderer (`canvas.addEventListener is not a function`). `offscreenGL` now requires a real
`WebGL2RenderingContext` and `transferToImageBitmap`; the nine GL shape gates that drive the real pass
(bay, footfall, glao, glbevel, glcluster, glfade, hftint, power, snow) pass with it.

## Built 2026-10-26: the GL canvas hands each pass over (`glTransfer`), and why the cabin's copy cost ~1 ms

The cabin goes into the WebGL canvas after the 2-D glass and rain (`GL_INTERIOR_HOOK`, after
`drawGlass`), and is copied onto the 2-D canvas with one `drawImage`, the fourth GL-to-2-D copy of the
frame. In the Modelshop (real WebGL2, 1280x720, a Halcyon cab at 13h, `drawImage` timed by caller) it
costs 0.65-1.1 ms. The sky and world copies cost 0.02-0.07, and the sky strip (`captureSkyStrip`,
the 2-D canvas into 256x128) 0.1-0.5. The cockpit's (`air`) is 1.02.

**What it isn't**, each tested in the page:

- Not the size of the copy. A 1x1 copy from the same canvas first costs 0.78-0.82 ms, and the
  full-frame copy after it 0.01. So copying only the cabin's screen bounds would save nothing.
- Not the 2-D context's state. Transform, filter, shadow, composite mode, alpha and smoothing are the
  same at all four copies.
- Not the GPU finishing the cabin. `gl.finish()` just before costs 0.01-0.03 ms, and the copy still
  costs 0.64-0.74 after it.
- Not a readback. Nothing calls `getImageData`, `putImageData` or `readPixels` in the frame. The only
  canvas uploads are the sky strip and the billboard atlas, both in the world pass.
- Not the cabin's draw. With the pass replaced by a bare clear of the default framebuffer, the copy
  still costs 1.1. With the canvas left untouched since the world copy, it costs 0.02.
- Not a second snapshot as such. A standalone 1280x720 WebGL2 canvas (MSAA, depth, alpha), drawn and
  copied four times in a row with every combination of clear, depth and coverage, costs about 0.2 ms
  a copy every time.

**What it is.** It's a stall of 0.7-0.9 ms that Chrome takes at a sync point between the 2-D
canvas and the WebGL canvas. Writing into the WebGL canvas while the 2-D canvas still holds an
unrasterised draw of it is what puts it at the cabin's copy. Moving the sync point only moves it:

- Reading one pixel of the 2-D canvas into a scratch canvas just before the cabin pass (a 2-D flush)
  costs 0.05 ms and drops the cabin's copy to 0.01-0.04. But the next sync point picks the cost up.
  With nothing after it, that's the next frame's sky strip (0.1 to 1.1-1.4 ms). With a 2-D flush
  after every frame, as the browser's commit is, it's that flush (0.06 to 0.64-0.98).
- Measured with a flush after every frame, all copies plus that flush come to: normal 1.83, 2.00 and
  2.02 ms a frame, with 0, 12 and 30 ms idle between frames; with the early flush 1.59, 2.00 and 2.19;
  with the cabin drawn but never copied 0.92, 1.12 and 1.04. Cockpit, 12 ms idle: 2.20 and 2.11
  normal, 1.64 and 1.25 without the copy. The idle gap changes nothing, so it isn't the GPU behind.

So the early flush was built (`cabFlush`) and taken out again: it moved the cost and saved nothing.
Without the cabin's copy the stalls fall by about 0.9 ms a frame. But a single composite would mean
porting everything the 2-D canvas draws between the world and the cabin to GL (the 2-D faces, the
weather, the glass and rain, night vision, the glare), so the fix went at the stall instead.

**The fix: the GL canvas hands each pass over (`RENDER_TUNE.glTransfer`, 1; 0 keeps the plain
canvas).** The GL canvas is an `OffscreenCanvas`, and each pass (sky, world, both cloud passes,
cabin) returns `transferToImageBitmap()` as `blit`. The bitmap owns that drawing buffer and the next
pass draws into a fresh one, so no pass ever writes into a buffer the 2-D canvas still holds, and
there's nothing to keep. `glBlit` in windshield.js draws the bitmap and closes it. Two limits:

- **A fresh buffer has a fresh depth buffer.** The cloud deck goes back for the city's depth, so the
  world is handed over only when that depth is in the float target (HDR live). With HDR off the world
  copy is the plain canvas as before.
- **`glLastFrame().canvas` is blank after a hand-over.** `__glWet`, `__glCluster` and `__glMirror`
  read it back, so they set the switch to 0 while they run. A browser with `OffscreenCanvas` but no
  WebGL2 in it keeps the plain canvas (`offscreenGL`, asked once). Node has neither, so headless
  benches and gates run the old path.

**Measured** (Modelshop, 1280x720, Halcyon, 12 ms idle and a 2-D flush after each frame, three
interleaved pairs), all GL-to-2-D copies plus the end flush, a frame:

| | `glTransfer` 0 | 1 |
|---|---|---|
| cab, 13h | 2.13, 2.20, 2.00 ms | 1.10, 1.19, 1.04 ms |
| cockpit, 13h (cloudy, clear, clear) | 3.40, 2.90, 3.08 ms | 1.81, 1.78, 1.49 ms |
| each world or cabin copy | 0.46-0.79 ms | 0.01-0.03 ms |

The saving doesn't reappear at the end-of-frame flush (0.06-0.09 against 0.11-0.21 ms). What's left
is the sky strip (`captureSkyStrip`, about 0.9-1.6 ms), the same at 0 and 1: that's a 2-D canvas read
of the 2-D canvas, another stall of the same kind, not touched here. With the default at 1 in a
fresh page, 89 copies over 30 frames arrive as bitmaps at 0.020 ms each.

**The picture is the same.** Final 2-D frame, 1 against 0, clock, date and random pinned, 16 settle
frames with the clock held still: cab noon 0.006% of pixels (worst 17), night 0.000% (1), rain
0.001% (3); cockpit noon 0.006% (33), night 0.002% (5), rain 0.003% (19). The 0-against-0 controls
are 0.000-0.005% (worst 3-24), and 1 against 1 0.000-0.005% (worst 2-17). In cloud with HDR on and
off (cockpit cloudy and overcast, cab cloudy) every pair is inside its control too. With a deck built
over Halcyon (four GL copies a frame) seen from below at 11h, 1 against 0 first read 3.3%; that was
the switch rebuilding the context and restarting the cloud volume's history. With both sides just
rebuilt and 48 settle frames it's 0.000% (worst 5). The shots are in `.claude/shots/interior-copy/`
(not tracked), with `diffs.txt`. `perf:exact glTransfer 0 1` is identical over 60 views (the old
path, as Node has no `OffscreenCanvas`; it covers the copy sites going through `glBlit`).

⚠ **These are synchronous benches.** They paint 30 frames in one task, which has no real frame
boundary, so the flush after each frame stands in for the browser's commit. A trace of the live
`requestAnimationFrame` loop with the pane in view is the honest check, and wasn't possible here (the
Browser pane was hidden for every run).

## Fixed 2026-10-25: kept strokes that cross the eye plane (`armNearWire`)

The older hole (see "Older, not fixed" under the `armFade` fixes below): on 200-frame recentring cab
flights, `perf:armkeep` missed 4 live triangles a frame on 5 frames at Marrow (from 136) and 2 on 28
at the lock (`911,926`, from 163), and the tree from before the 2026-10-24 work did too.

**What it was.** Each missing pair was one stroke. At Marrow, frame 136, it was a `signtube` (the
neon tube round an authored sign board, glass/authored-detail.js, drawn with `emitLightRunner`): the
live draw had the ring's top and bottom runs ending at y 0.317 and no right-hand side, and the kept
draw had them ending at 0.323 with the right-hand side as well. At the lock, frame 170, it was a light
runner (blue, `w1.6`), live ending at 0.201 and kept at 0.414. `emitWire` cuts a segment at `NEAR_W`
(0.13 tiles) in front of the eye and drops one wholly behind it, from where the eye is that frame. A
kept set was recorded from well back (the probe's near test), and the replay pushed the stroke
whole. That isn't only a test difference: the strokes shader takes a stroke's width from its
projected ends, which mean nothing once one end is behind the eye, so the cab drew the tube with a
wrong width as it drove up to the sign. It wasn't a recentre shift, a face test or a live part.

**The fix** (`RENDER_TUNE.armNearWire`, 1; 0 replays the stroke whole as before): before a replay,
`armNearWire` takes each kept stroke's raw ends (`ra`/`rb` for a stroke the GPU pulls, else `a`/`b`)
into this frame's camera frame and asks `cam.rawF` of each, against the same 0.13. A stroke with its
ends either side of the plane runs the building live for the frame (`armKeepStats.nearWire`), and the
set is kept, not dropped. Wholly behind is left, as the GPU clips it, as it does every kept part behind
the eye. Both replay paths ask it: the ordinary one and the haze band's.

**Proof.**

- `FRAMES=200 FLY="marrow;cab;13;0.03;20" perf:armkeep` and `FLY="911,926;cab;13;0.03;20"`: 0 frames
  missing anything (were 5 and 28). The default list passes (600 frames).
- Mutation: `TUNE=armNearWire=0` fails both flights (5 and 28 frames), and so does the test with its
  plane moved to -1 (a temporary mutant, removed).
- `perf:exact armNearWire 0 1` is identical over 60 views (still views never get near enough).
- `recentre-exact armNearWire 0 1` (`--churn 40 --cloth`) differs on 7 of 200 frames at Halcyon
  (cockpit), 21 at the lock cab and 17 at Marrow (cab). With the count read every frame, those are
  exactly the frames where `nearWire` fired: none differs where it didn't, and none where it fired
  is the same.
- Cost, `perf:move --prof`, three alternating pairs: `world:arms` 2.93, 3.10, 3.02 against 3.05,
  3.00, 2.96 ms at the lock cab, 8.77, 8.61, 8.68 against 8.75, 8.60, 8.74 in the Halcyon cockpit.

## Measured 2026-10-25, not changed: `cssRgb`'s double lookup

`cssRgb` asks its memo `has` and then `get`. One `get` (a miss is `undefined`; a colour that doesn't
parse is memoised as `null`) is exact, but it saves nothing measurable. V8 keeps a string's hash on
the string, so the second lookup is a probe and no hashing. Halcyon cockpit, `--gl`, three
alternating pairs: `cssRgb`'s self time in a CPU profile 79, 84, 92 ms over 200 frames with two
lookups against 83, 97, 89 with one, and `world:arms` 9.51, 9.94, 9.45 against 10.08, 10.07, 9.62.
The function is about 0.4-0.5 ms a frame in all, and what it costs is the strings its callers build
for it, not the lookup. It stays as it was.


## Built 2026-10-25: GLASS 1 is a plain fallback in the game (`glass1Basic`, Phase 3)

Phase 3 of the plan. GLASS 1 (the canvas path) ran the whole city: every arm and its faces painted,
124-175 ms a Halcyon cab frame and 360-407 ms an aircraft one in the Modelshop at 960x540, 69,000 to
177,000 canvas calls a frame. Almost all of it was `world:arms` and `world:flush`; the floor, ground
and sky were 10-30 ms. Each lever, measured in the browser with the pane in view:

| step | Halcyon cab | Halcyon air | Marrow cab |
|---|---|---|---|
| full painter | 121-175 ms | 358-407 | 95-141 |
| boxes from captured segments, no arm adornments | 89-94 | 217 | 66-72 |
| + draw distance capped at 16 tiles (`farMax`) | 90-102 | 135-182 | 66-76 |
| + every building its single biggest box (`lodFar` 0.002) | **43** | **66-70** | **36-38** |

Flat walls instead of the textured blit (`wallLodPx` huge) bought 5-10 ms in a cab and nothing from the
air, so it isn't in the tier: the cost was the number of faces, 3,963 a cab frame against 424 with the
single-box LOD. `GLASS1_BASIC` holds the values; `glass1Basic` defaults to 0 so the Modelshop and every
gate keep the full painter, and the game turns it on at boot (main.js `window.__glass1BasicPending`).
Gates: shapes smoke, framecost (back to its exact baseline, 342,761 calls), bigscreen, worldresidue,
parse, imports. Pictures checked by eye side by side in the Modelshop: the same city as plain boxes
that keep their glazing texture, streets intact, no holes. Not measured on a phone.

## Fixed 2026-10-25: why `world:gl` rose 1.5 ms with `marksGPU` on

`armCanon` read decal points and bay points through one helper, `pt`. A decal's points are
object-kind arrays and a bay's are double-kind, and once V8 optimises `pt` with both maps in its
feedback it unifies them: it turns every double array it reads into an object array, with a boxed
number per coordinate. A building's kept bays go out as a retained group, so that never cost
anything. A kept mark's bays stream (they smooth every frame), so about 1,800 converted point
arrays a frame reached `putVertex` and `smooth` in gl/solids.js. Both deopted on the new map
("wrong map", only at 1) and came back polymorphic, and from then on they converted every point
array they read, a mark's or not. The fix is `ptB`, a reader that only ever sees bays, used at
`marksGPU` 1. At 0 `armCanon` takes the old line.

How it was found, so nobody chases the same leads:

- The work is the same at 0 and 1: the same faces, metals, `smooth` calls and floats written (757k a
  cockpit frame). `smooth` never takes its same-set path at either value, and the world solids
  upload isn't incremental at either.
- The difference is GC. Over 300 frames of the Halcyon cockpit `--gl` flight (`--trace-gc-nvp`), a
  scavenge promoted about 1 MB at 0 and about 3 MB at 1, steadily (300 against 490 to 700 MB in
  all), and scavenge pause went from 500-570 to 670-820 ms. Running the marks live instead of kept
  put it back to 0's numbers. Per run the total is bimodal (490 or 700 at 1, and once 520 at 0), so
  one run proves nothing; these are three or more each.
- Ruled out: the normals' elements kind (forcing the marks' normals to double arrays changed
  nothing over three runs; one run first said it halved the extra, and that run was noise),
  `smooth`'s fresh `vn` arrays on kept records (reusing them in place changed nothing), and fresh
  copies of the kept records at replay (no change, so it isn't the solids path writing onto
  long-lived records).
- What showed it: with `--allow-natives-syntax`, about 1,800 mark records at 1 had object-kind
  points (none at 0), though they were double-kind when pushed and nothing wrote to them. Checking
  the tracked arrays' kind at every push localised the change to inside `armCanon`, and
  `--trace-elements-transitions` showed the transitions in optimised anonymous code and in `pt`.

After the fix, with the same tools: no mark record has object-kind points, the "wrong map" deopts
in `putVertex` and `smoothCell` are gone (one remains in `smooth`, the lock's record shape), and a
scavenge promotes no more at 1 than at 0 (283-288 against 299-304 MB, pause 504-523 against
532-571 ms, three runs each).

**Headless**, `perf:move -- <place> <seat> --frames 200 --turn 0.2 --gl --prof`, medians, three
pairs alternating 0 and 1, against the table in the section below (taken before the fix):

| | Halcyon cockpit, 0 | 1 | lock cab (`911,926`), 0 | 1 |
|---|---|---|---|---|
| `world:gl` before the fix (ms) | 7.8-8.8 | 9.3-10.6 | 4.2-4.6 | 4.8-5.3 |
| `world:gl` after (ms) | 8.34, 8.38, 8.48 | 8.14, 8.06, 8.57 | 4.38, 4.20, 4.28 | 4.29, 4.41, 4.45 |
| `world:arms` after (ms) | 10.18, 10.78, 10.29 | 8.95, 9.33, 9.44 | 3.64, 3.61, 3.60 | 3.08, 3.12, 2.95 |
| paint median after (ms) | 27.1, 27.8, 26.9 | 26.1, 27.3, 28.6 | 12.0, 11.6, 11.5 | 11.3, 11.4, 11.2 |
| paint total after (ms, 200 frames) | 4814, 5179, 4808 | 4686, 4795, 5080 | 2181, 2139, 2182 | 2057, 2080, 2061 |

CPU-time means a frame over frames 30+ (`process.cpuUsage`, three pairs, the lock cab at `911,925`
heading 0): cockpit paint 29.7, 28.6, 30.9 against 28.2, 26.6, 27.3, `world:gl` 13.6, 14.4, 15.0
against 14.8, 14.6, 14.7; cab paint 14.3, 14.4, 14.7 against 14.7, 13.6, 13.2, `world:gl` 8.8,
7.9, 9.3 against 9.6, 8.1, 8.0. So `world:gl` is level and the arms saving is now the frame's.

**In the browser**, the Modelshop's `__glWhere` (real WebGL2, 60 frames after 10 warm, the heading
swept 11 degrees a frame), 0 against 1 interleaved. ⚠ These were taken with the Browser pane hidden
for most runs (a background page, timers throttled) and another browser using about half a core,
so the absolute numbers are inflated and noisy, about twice the first set's. Read them as pairs
under the same conditions, not as frame times. Five pairs at each place, minimum and median (ms):

| | lock (cab, 911,926), 0 | 1 | Halcyon (air), 0 | 1 |
|---|---|---|---|---|
| frame | 21.2 / 24.2 | 20.7 / 23.4 | 52.9 / 55.5 | 46.5 / 48.6 |
| GPU | 15.3 / 17.4 | 14.3 / 16.4 | 37.5 / 39.1 | 30.5 / 34.3 |
| `world:arms` | 4.83 / 5.50 | 4.53 / 4.90 | 18.3 / 21.3 | 15.6 / 16.7 |
| `world:gl` | 9.40 / 9.65 | 9.30 / 11.67 | 18.2 / 19.3 | 16.5 / 17.3 |

At Halcyon 1 is lower in every column. At the lock it is within the noise: the minimums agree and
`world:gl`'s median is higher at 1, in runs whose spread is 9 to 13 ms. An earlier set of three
pairs, less loaded, said the same at the lock (frame 13.2, 13.9, 13.1 against 13.8, 12.4, 13.1;
`world:gl` 5.9, 6.3, 6.0 against 6.7, 6.0, 6.3). Worth taking again with the pane in view before
deciding. `marksGPU` stays 0.

**Taken again with the pane in view** (2026-10-25, `visibilityState` visible for every run, a fresh
Modelshop, 960x540, five pairs at each place, 0 and 1 alternated and the order flipped each pair,
both paths warmed first). Medians, 0 / 1:

| | lock (cab, 911,926) | Halcyon (air) |
|---|---|---|
| frame | 11.09 / 11.18 ms | 25.65 / 24.01 ms |
| GPU | 5.99 / 6.92 | 10.51 / 9.92 |
| `world:arms` | 2.77 / 2.77 | 9.91 / 8.00 |
| `world:gl` | 4.78 / 4.87 | 9.69 / 9.36 |
| pairs where 1 was faster | 2 of 5 | 3 of 5 |

From the air 1 saves about 1.6 ms a frame (6%), most of it in the arms. From the cab at the lock there's
no difference outside the noise. David saw the shots and these numbers and turned it on (2026-10-25).

## Built 2026-10-24, on since 2026-10-25: the marks shaded on the GPU and kept (`marksGPU`)

The South Lock, the AA batteries, the media lot and the statue shaded every face on the CPU from the
eye and turned its normal toward it, so every record moved with the camera, nothing about them could
be kept, and they rebuilt every frame (1.25, 0.78, 0.47 and 0.40 ms of a moving Halcyon cockpit
frame, headless). `marksGPU` (0 shipped; 1 is the new path) does two things.

- **The shading goes to the solids shader** (gl/solids.js, "the marks"). A face goes over unshaded,
  with its normal as wound and a code in `tex`: −2 to −4 are `makeShade` (glass/aa-emplacement.js,
  glass/media-lot.js: plain, metal, glass), −5 and −6 `statueShade` (wet and never wet), −7 the
  statue's copper (`statueDiffuse`, then the copper branch). The shader turns the normal to the eye
  per pixel and runs the CPU's own arithmetic; the frame they're lit in (`MARK_ENV`: makeShade's and
  statueShade's light, night, wet, the sun share, the statue's sky) rides on the faces as `menv` and
  becomes uniforms, as a metal's `env` does. The lock already lit in the shader, so it only needed the
  turn: its faces go over facing out of the hall (from its axis, `AXA`) so neighbouring metals still
  smooth together, and the shader turns them (code −1). No mark face is lit by the city's lamps or
  tinted by the sky below, as none was. ⚠ `putVertex` wrote a face's code only with local points, so
  a first version sent every mark face as code 0 and the shader never ran on them; a negative code
  now goes without. ⚠ The vertex shader rounds the code with `floor`, not a cast, for the negative codes.
- **Each mark is two passes, and the static one is kept as a building's arm is** (`markKept`): the
  same detection (two probes, the clock tests, rechecks, live on anything a replay can't do). Static:
  the lock's halls, frames, doors, gantries and boards; the AA's pit, bags, hatch and radar mast; all
  of the media lot; the statue, its fixed wires and its uplighters. Dynamic, every frame: the lock's
  end walls (their colour and bow are chosen by the side the eye is on), eye, field collar, approach
  studs and board text, and the whole lock in lockdown or on a red; the AA's mount, guns, radar array,
  lamps and the aim's memory; the statue's water and every ground pool (a side channel). A mark is
  filed under a stand-in per cell, because a lot wall stands on a building's tile, and its faces
  stream rather than going as a retained group (the metals smooth every frame). `drawTypeModelKept`
  took an `extra` key term for a mark's near detail and the statue's wetness.

**What it changes on screen.** The marks shaded from `cam.ex − cam.ox`, which isn't the eye: the eye
is at `(ex, ey)` in the frame they draw in (makeCam; faceAway and the kept arms read it that way), so
they lit each face as seen from a point off by the camera's place in the map window. The shader
uses the real eye. Where that offset is 0 the two agree, and the shots below are taken there, so
they show the shading port and not the eye. In the game, the marks will light from the right place.

**The shots for David**, in the Modelshop (real WebGL2, 960x540, a camera with no ship, pinned clock,
date and random, 30 settle frames each; for each, a warm-up at 0, then 0, 0 again for the control,
then 1), in `.claude/shots/marks-gpu/` (not tracked: the folder ignores itself): `<item>-<noon|night>-<0|1>.png`,
one `<item>-sheet.png` per mark with the four side by side and their numbers, and `diffs.txt`.

| shot | 0 against 0 | 1 against 0 |
|---|---|---|
| lock noon / night | 0% (worst 1) / 0% (1) | 0.04% (105) / 0.02% (10) |
| AA noon / night | 0% (1) / 0% (2) | 0.07% (9) / 0% (3) |
| lot noon / night | 0% (1) / 0% (1) | 0% (2) / 0% (1) |
| statue noon / night | 0% (1) / 0% (2) | 0.02% (13) / 0.02% (24) |

**Proof that 0 is today's path.** `perf:exact marksGPU 0 0` is identical over 60 views. Against the
tree as it was before this work (a copy taken first), `recentre-exact`'s child flown in both with
`marksGPU=0` and the same arguments matches every list on every frame: 200 frames each at Halcyon
(cockpit, 13h and 22h), Marrow (cab) and a cab at the lock (911,926), all with `--churn 40 --cloth`,
and again after the last change with `armFace3` (below, newer than the copy) also at 0. With
`armFace3` at 1 the lock cab differs from the copy on 12 frames: kept slum sheets taking the tone the
live arm gives them, which is that switch's fix.
The same flight with the new tree at 1 differs on 200 of 200 frames, in the bay, decal, sprite and
stroke lists only. **And that it touches only the marks:** `perf:exact marksGPU 0 1
--without=lock,aa,statue,lot` (the four taken off the map) is identical over 60 views; with them on
it differs in every view. **And that a kept mark draws what a live one does:** `TUNEALL=marksGPU=1
perf:armkeep` (the switch on in both flights) passes, 600 frames.

**Speed**, headless, `perf:move -- <place> <seat> --frames 200 --turn 0.2 --gl`, 0 against 1, pairs
run alternately (the lock cab is `911,926 cab`, driving north into the lock):

| | Halcyon cockpit, 0 | 1 | lock cab, 0 | 1 |
|---|---|---|---|---|
| paint median (ms) | 27.2, 31.9, 28.6, 26.8, 27.0 (mean 28.3) | 30.3, 28.3, 28.7, 30.6, 28.5 (29.3) | 11.1, 11.2, 11.3, 11.8, 11.1 (11.3) | 12.6, 11.9, 11.5, 12.0, 11.3 (11.9) |
| paint p99 (ms) | 54.5, 58.4, 45.5, 41.4, 39.2 | 45.5, 52.0, 43.2, 51.3, 40.8 | 19.8, 18.0, 18.9, 26.3, 21.4 | 32.8, 19.3, 22.0, 20.4, 21.8 |
| `world:arms` (`--prof`, ms) | 9.73, 9.89, 9.86, 9.68, 9.53, 9.83 | 8.88, 9.07, 8.90, 9.26, 9.14, 8.99 | 3.70, 3.74, 3.68 | 3.06, 3.04, 2.98 |
| `world:gl` (`--prof`, ms) | 8.76, 8.72, 8.22, 8.01, 7.87, 7.82 | 10.35, 9.55, 10.60, 9.45, 9.34, 9.78 | 4.23, 4.63, 4.46 | 5.31, 4.83, 4.94 |
| `perf:alloc` (MB a frame, two runs) | cockpit 23.10, 22.81 | 20.61, 20.73 | Halcyon cab 11.99, 12.20 | 11.11, 10.86 |

Per item (arms profiler, ms a frame): from the lock cab the lock went 1.29 → 0.73; from the
cockpit the lot 0.47 → 0.04, the statue 0.40 → 0.21, the AA 0.78 → 0.48. From the cockpit's heading
the lock is beside and behind the craft the whole flight, so it is never probed (a kept-arm probe
needs the building well in front) and its static pass runs live as well as its dynamic one: 1.25 →
1.40. Once kept, a set replays from any side. Residential cockpit allocates 18.66, 18.60 → 16.62,
16.57 MB.

⚠ **So at 1 it is not faster headless yet.** (Found and fixed 2026-10-25, in the section above: V8
converting the kept marks' point arrays. The guess below about type feedback was close; the rest of
this paragraph is what was known before.) `world:arms` falls by 0.7 to 1 ms in both seats and
allocation by 1 to 2.5 MB a frame, but `world:gl` rises by about as much. The extra is all in the
solids upload (`putVertex` and `smoothCell` about doubled in a CPU profile, `writeQuad` and `smooth`
up), for the same number of faces, metals and floats written (757k a cockpit frame either way), and
with the lock left on the old path the rise is the same, so it comes from the AA, lot and statue
faces carrying normals. Uploading one captured frame's faces in a loop shows no difference between
the two (5.6-7.8 against 6.8-7.5 ms), and both runs deoptimise `writeQuad` and `putVertex` on "wrong
map", so the likeliest cause is V8 losing type feedback in that shared path, not more work; it isn't
proved. The `menv` scan was one cost and is gone (the frame rides on the bay list now), without
changing the totals. Not measured in the browser: there the upload runs at about half the headless
cost, and the arms saving is the same work, so the balance may differ.

New in the scripts: `perf:move` and `recentre-exact` take a world tile `x,y` for a place and a
`--heading`; `perf:exact` takes `--without=`; `perf:armkeep` takes `TUNEALL=` (both flights),
`FLY=place;seat;hour;move;rec` (one flight) and `FRAMES=`.

## Fixed 2026-10-24: two holes in `armFade`'s detection, and one older one it showed up

The marks work flew `armFade` somewhere new (a cab at the South Lock) and two things failed:

- **A set kept at alpha 1 was scaled without ever being tested.** One probed in the band is compared
  with the live draw at its fade; one kept at full alpha that drifted into the band was scaled
  straight away, and an arm that scales a glow's colour rather than its alpha (the lock's light lines)
  isn't proportional. Now its first fading frame records the live draw and compares (`fadeOK`), and
  until then it runs live.
- **`slumFaceK` turned a sheet to the eye with a test of its own**, and the tone it picks is in the
  sheet's decal key, so a kept slum building kept the tone of the side it was probed from after the
  eye crossed to the other. That's older than `armFade`; `armFade` keeps more of them. `faceAway3`
  records the test (three dimensions, it reads the eye's height) and `armReplay` asks it again
  (`armFace3`, 1; 0 tests it unrecorded).

With both, `recentre-exact armFade` at the lock cab has nothing missing on the frames checked, only
extras (a dish and a blade sign the live arm drops behind a nearer building or edge-on, which a kept
set leaves to the depth buffer, as every kept set does). `recentre-exact armFade` still matches at
Halcyon (cockpit), Marrow (cab, 13h and 22h), `perf:armkeep` passes, and so do its 60-frame flights
at the lock cab (`FLY=911,926;cab;13;0.01`, at 22h, and recentred every 20 frames).

⚠ **Older, fixed 2026-10-25 (`armNearWire`, at the top): long recentring cab flights lose a few triangles from kept sets.**
`FRAMES=200 FLY="911,926;cab;13;0.03;20" perf:armkeep` misses 2 live triangles a frame on 28 frames
from frame 163, and `FLY="marrow;cab;13;0.03;20"` 4 on 5 frames from 136. The same with `armFade`,
`armFace3` and `armLiveSide` all at 0 (28 and 5), and the tree from before this work (37 and 5), so it
predates them. `perf:armkeep`'s own flights are 60 frames and never got that far.

## Built 2026-10-24: buildings in the haze band keep (`armFade`, step 2.1)

A building dissolving at the draw limit ran live every frame: alpha was in its kept key and moved with
every frame of travel (`drawTypeModelKept`'s `it.alpha < 1` return). From a Marrow cab that's 7.6
buildings a frame, most of them authored. A temporary probe that made them draw nothing (removed) put
the ceiling at 0.6 ms of `world:arms` from the cab (5.72 → 5.11, three pairs) and nothing from the
cockpit: there, a building that far out is past the distance ladder's last ring and draws mass only,
so no fading building reaches an arm at all.

**What it does** (`armFade`, 1; 0 runs them live as before). The model arms never test their alpha;
it only scales what they push. So alpha leaves the key, and a fading building's kept set is its
recording at alpha 1, the same set it keeps once fully in. A fading frame pushes the set with every
record's alpha times the fade (`armFadeKept`, `armFadePut`).

- **Detected, not predicted.** A probe in the band records the frame's live draw and a scratch run at
  alpha 1 (`run` takes an alpha now), and keeps only if the scaled set is the live one
  (`armFadeCanon`), after the usual two clock tests and a second probe from a moved pose. A recheck in
  the band compares the same way. A set with a live part (handed the alpha it was recorded at) or one
  that fails the comparison runs live while it fades (`noFade`, `fadeLive`).
- **The primitives' cut-offs.** `pushLight` drops a light at alpha 0.002, `pushStroke` a wire at
  0.004, and `glowPool` enters the rain census only above 0.05. A frame where any scaled record would
  land within rounding of one of those runs live (`armFadeSafe`, `fadeEdge`). The census replay
  applies glowPool's own 0.05 test at the scaled alpha.
- **Through the stream, as fresh copies.** A retained group is written to the GPU once, and here the
  alpha changes every frame. ⚠ The copies are new objects each frame. A first version rewrote one set
  of copies in place, and `perf:retain` caught it drawing last frame's alpha: a record a layer has
  seen is taken to be what it was (gl/solids.js skips the same record at the same slot).
- **Not the shader version the plan named.** That would also save uploading the faint records, but
  needs a building centre on the sprite, stroke, decal and solids vertices, plus the mirror and an
  expansion for the checks, for what's left of a 0.6 ms ceiling once the arm runs are gone. With the
  fade on the CPU the sinks hold the real records, so `perf:exact` and `recentre-exact` compare them as
  they are.

A first version of the band's recheck canonicalised the kept set at this frame's offset instead of
its own (`e.kept.ox`), and every recheck failed by exactly one frame of travel. ⚠ A kept set's records
are where the last replay moved them; compare them in their own frame.

**Counts**, Marrow cab, 170 frames: fading buildings 7.6 a frame, of which 4.6 replay, 1.2 run live
(`noFade`: the pier and the boatshed carry live parts) and none were at a cut-off. `perf:armkeep`'s
Nightlife cab flight keeps 60 buildings where it kept 22, with 985 replays against 322.

**Speed**, headless, Marrow cab, switch off against on, pairs run alternately:

| | off | on |
|---|---|---|
| paint median (ms) | 14.0, 14.3, 16.7, 14.4, 14.6 (mean 14.8) | 14.3, 13.8, 14.0, 14.8, 14.0 (14.2) |
| paint p99 (ms) | 20.4, 29.8, 33.5, 29.6, 26.2 | 24.8, 27.2, 24.9, 21.9, 26.6 |
| `world:arms` (`--prof`, ms) | 5.16, 5.64, 5.73 | 5.85, 4.83, 5.50 |
| every building item, `@model` (arms profiler, ms) | 3.51, 2.94 | 2.43, 2.25 |
| authored arm runs a frame (ms) | 7.5 (0.98, 0.88) | 4.6 (0.57, 0.60) |

The arms profiler, which times each item, shows 0.7 to 0.9 ms off the building items. The phase
timings and the paint medians are noisier than that on this machine: the mean paint median is 0.6 ms
lower, but one pair carries most of it. Halcyon cockpit paint medians: 51.3, 28.3, 29.6 off against
36.2, 28.6, 29.7 on (the first pair was a slow moment for both). `perf:alloc` (two pairs): Halcyon
cab 12.65, 12.57 → 12.30, 11.93 MB a frame; the cockpit cases inside their noise.

**Proof:**

- `recentre-exact armFade --cloth --churn 40` matches over 200 frames at Halcyon (cockpit) and at
  Marrow (cab) at 13h and at 22h. That's the flight that crosses the band with the real records
  compared. A fade 0.1% wrong on the sprites (`× 1.001`) fails 132 of the cab's 200 frames; the
  cockpit route has no fading arms to catch it with.
- `perf:armkeep` passes (600 frames); its Halcyon cockpit 22h flight replays 71 fading sets. The same
  mutant fails 184 of 600 frames. (A first mutant run also showed cloth differences that a rerun
  didn't repeat; every flight re-reads the source, and peers edit this checkout.)
- `perf:exact armFade --cloth` is identical over 60 views, which proves only that the scratch run at
  alpha 1 leaves nothing behind: three paints never keep a building.
- `perf:retain` passes. The Modelshop shots, one per call, 0 saved, 0 again, then 1: Marrow cab noon
  0 / 0.01%, Halcyon cab dusk 0 / 0, Marrow cab night 0 / 0, Halcyon air noon 3.12 / 3.14%. ⚠ A
  refshot paints a still pose and a fading set only keeps across a move, so these prove nothing
  regresses at a still camera, not the replay; the flights above prove that.

## Skipped 2026-10-24: `flatEarly` for the other arms

The arms that still build flats `emitFlat` drops (a temporary tally by caller, removed): from a
Marrow cab the fuel yard's ground paint 12.7 a frame, the ATC tower 12.1, the Meridian 23 through its
`Pq` helper, Second Helpings 16 and the clone facility 12 through `flatOut`, Watts 5 through `tcFlat`,
Arrivals 13 through `observationCrown`; from a Halcyon cockpit the box office 12.2 and the sports bar
15.8 through `flatOut`, the church 17.6 through `wallRose` and 5 through `emblemSlab`, the cinema 13
through `arch`. In the CPU profile `flatOut` outside the ballpark is about 21 ms over 200 profiled
frames (about 0.06 ms a frame), and `wallRose`, `emblemSlab`, `tcFlat` and `observationCrown` under
0.05 ms each. Every one is inside the noise, so none was done. What the ballpark had that these
don't is clipping each flat to the tile.

Noticed on the way: `cssRgb` is 139 ms of the same profile, 83 of it from `emitFlat`'s drop test, and
it looks its memo up twice (`has`, then `get`) with a freshly built colour string. One `get` would
halve that, about 0.1 ms a frame. Not done.

## Built 2026-10-24: the live arms and marks, profiled and cut where it was exact (`flatEarly`, `armLiveSide`)

With armChunk dropped (below), the next thing to cut was what `world:arms` is made of. Per item, the
arms profiler (`setWindshieldProfiler(true, { arms: true })`), headless `perf:move --gl --turn 0.2`,
ms a frame (calls a frame):

| item | Halcyon cockpit | Marrow cab | why it runs every frame |
|---|---|---|---|
| the South Lock (`@mark:lock`) | 1.25 (11) | 1.11 (11) | a mark with no kept path; every face's normal is turned to the eye |
| the ballpark (one tile's arm) | 0.87 (0.7) | | too near to probe, or between probes; and the arm itself was dear |
| AA batteries (`@mark:aa`) | 0.78 (3.9) | 0.38 (1) | a mark; every face shaded on the CPU from the view direction |
| the media lot (`@mark:lot`) | 0.47 (3) | | the same, through the same `makeShade` |
| the statue (`@mark:statue`) | 0.40 (1) | | the same, through `statueShade` |
| camps (`@mark:camp`) | 0.36 (13) | 0.05 | already kept (campKept); this is its replay and facing tests |
| authored buildings | 0.31 (6) | 0.65 (7.5) | in the cab, inside the probe radius (`near`) or in the haze band (`fading`) |
| the clone facility | 0.27 (0.6) | 0.33 (1) | live for `pose`: its vats turn to the eye |
| quay cranes | 0.20 (2) | 0.10 (1) | live for `clock`: the trolley moves |

Two things turned up that weren't on the list. A temporary tally of which branch of
`drawTypeModelKept` ran each arm (removed) showed that the ballpark wasn't live: it was mostly too
near to probe. And the arms profiler counts the flats `emitFlat` throws away under `FLAT_OFF`
(`%drop:`): the ballpark built 148 a frame and the clone facility 129 (199 from the Marrow cab), each
one clipped, coloured and then dropped, because GLASS 2's mesh already has it.

**`flatEarly`** (1; 0 builds them all as before). `flatsDropped()` and `massDropped()` (windshield.js)
are `emitFlat`'s and `draw3DBoxAt`'s own drop tests, asked first. The ballpark's `box`, `seg`,
`segCut`, `arc`, `flat`, `face`, `litFace`, `vface`, `fan` and `ring` and downtown.js's `tubeRun`
return at once when the answer is yes. Neither drop has run anything by then (`emitFlat`'s
`faceAway` comes after it; `hfSkin` is a lookup), so it's exact. Ballpark 0.87 → 0.34 ms a frame, clone
facility 0.27 → 0.11, and their drops 148 and 129 → 0 and 15.

**`armLiveSide`** (1; 0 counts as before). `windFlag` is a live part (`armLiveCall`), but on the GL
cloth path its cloth goes into `FAUNA_SINK`, and `armRecord` counted every side-sink push in the run
against the kept set. So every building with a flag on GL went live (`side:fauna`: the ballpark's
roof tile, the pier, four in the Marrow cab). A live part's pushes into the side sinks a recording can
cut back (scatter, curtain, face, ownship, fauna, ground, late billboards) now count as the live
part's, since every replay calls it again. A live part's canvas call or ground-late job still makes
the building live, because neither can be taken back. A recording put back in its place (a clock
test, a recheck, the frame a set is kept) now cuts those sinks back too (`armSideTrunc`), or its
flag would be drawn twice. With the switch on, liveRun over a 170-frame Halcyon cockpit flight went
from 1,933 to 1,166 and kept from 122 to 132.

**Speed**, headless, `perf:move -- <place> <seat> --frames 200 --turn 0.2 --gl`, both switches off
against both on, pairs run alternately (five pairs for paint, three with `--prof` for the phases):

| | Halcyon cockpit, off | on | Marrow cab, off | on |
|---|---|---|---|---|
| paint median (ms) | 27.5, 30.2, 32.1, 30.1, 29.8 (mean 29.9) | 27.8, 31.7, 27.9, 29.0, 30.8 (29.4) | 15.8, 14.7, 15.9, 15.0, 14.3 (15.1) | 14.7, 14.6, 14.8, 14.2, 14.8 (14.6) |
| paint p99 (ms) | 46.9, 47.2, 69.8, 46.1, 77.6 | 53.3, 90.9, 41.6, 44.0, 49.2 | 29.0, 22.7, 39.7, 29.4, 23.6 | 22.4, 22.6, 26.7, 23.1, 25.9 |
| `world:arms` (ms) | 10.89, 11.46, 10.81 (11.05) | 10.86, 10.93, 10.35 (10.71) | 5.26, 5.50, 5.56 (5.44) | 5.25, 5.31, 4.91 (5.16) |
| `world:gl` (ms) | 8.37, 8.75, 8.57 | 8.51, 8.46, 8.06 | 5.75, 5.25, 5.16 | 5.14, 5.13, 5.22 |
| liveRun over 170 frames | 1,933 | 1,166 | 697 | 500 |

So about 0.3 ms of `world:arms` in each seat. The cockpit's paint median moves inside its noise (the
pairs differ by −4.2 to +1.5 ms); the cab's is about 0.5 ms lower, and its p99 tighter, in four pairs
of five. The machine was shared, so read the ratios, not the absolute numbers.

**Proof:**

- `perf:exact flatEarly` is identical over 60 views, with and without `--cloth`. `recentre-exact
  flatEarly --churn 40` matches over 200 frames at Halcyon (cockpit) and at Marrow (cab), at 13h and
  at 22h. A guard in the wrong primitive (the ballpark's glow `pool`, which isn't dropped) fails
  `perf:exact` on 10 of 60 views and `recentre-exact` at 22h from frame 10.
- `armLiveSide` changes which buildings keep, so the check that counts is `perf:armkeep`, which now
  flies with the GL cloth path on (`CLOTH=0` for the old flights) and compares each frame's cloth
  records as well as the triangles and the light census. It passes: 600 frames, none missing, and
it passes with `TUNE=armLiveSide=0` too (kept 156 against 152 on the recentred flight).
  `recentre-exact armLiveSide --cloth --churn 40` matches over 200 frames at both places, and
  `perf:exact armLiveSide --cloth` over 60 views (which only proves the clock tests don't leave a flag
  behind: three paints never keep a building). A mutant that doesn't cut `FAUNA_SINK` back fails
  `perf:armkeep` on 14 of 600 frames and `recentre-exact` from frame 151.
- `perf:retain` passes. `perf:alloc` moved inside its noise, two alternating runs each: cab 12.72,
  12.73 → 12.58, 12.44 MB a frame; cockpit 24.03, 22.99 → 23.41, 22.95; residential 18.88, 18.68 →
  18.16, 18.64. ⚠ That's a spread of up to 1 MB on one case, not the 2% the tool's header says.
- The picture, in the Modelshop, one shot per `__glRefShots` call, both switches at 0 saved, 0 again
  and then 1 against it (share of pixels moved): Halcyon air night 0.01 / 0.01%, Halcyon air noon
  0.02 / 0.01%, Halcyon cab night 4.58 / 4.60%, Marrow cab noon 0.03 / 0.05%, Marrow air dusk 0.78 /
  0.80%. Every shot is inside its own 0-against-0 floor.
- The scene helper (scripts/perf/scene.mjs) takes `cloth: true` now, and `perf:exact` and
  `recentre-exact` take `--cloth`: without it neither ever saw a flag's cloth.

**Skipped, and why:**

- **The lock, AA, the media lot and the statue.** Each rebuilds CPU-shaded solids every frame, with
  every normal turned to the eye, and the AA, lot and statue shade from the view direction as well
  (specular, `statueShade`'s reflected ray). So their records move with the camera and can't be
  kept, and a sideways cull isn't exact either: `pickLights` takes lights from beside the view, and
  off-screen solids still cast into the shadow map. What would cut them is the shading and the flip
  done in the solids shader (two-sided from the eye), after which they'd keep as groups. That's a
  shader change with a picture to judge, so it wasn't done here. The lock already reuses each slot's
  record (`lockCache`); what's left is the generator and the normal per face.
- **Authored buildings in the cab.** They run live inside the probe radius (`ARM_NEAR + 2·fh`) and in
  the haze band, both rules of the kept path. The haze fade in the shader (the plan's `armFadeGPU`,
  2.1) is what would keep them.
- **Quay cranes**, 0.1 to 0.2 ms: inside the noise. The trolley is inline in the arm, so making it a
  live part means moving about 80 lines into a helper.
- **Camps**, 0.36 ms: they're already kept. What's left is the replay itself.
- **Not on the list but the same fix:** other arms drop flats too (church 30 a frame, sports bar 21,
  box office 19, cinema 18 from a Halcyon cockpit; Second Helpings 76 and the Meridian 33 from a
  Marrow cab). They build them through shared helpers (`flatOut`, `drawFacetDrum`) that also take
  `paint` and gradients, so each needs its own look.

## Measured 2026-10-24: armChunk's ceiling (Phase 2.2, not built)

Phase 2.2 of the plan (`armChunk`) would stop kept buildings pushing their records into the sinks
every frame: slot tokens, pinned arena slots, per-chunk multi-draw, light candidate tables. It was
estimated at −3 to −5 ms in the browser. Before building it, the most it could save was measured: a
temporary line at the top of `armReplay` returned at once, so a kept building pushed nothing and drew
nothing. That removes every cost a kept building has after its key (the shifts, the sink pushes,
`splitGroups`, the layers' group handling and arenas, `pickLights` over its sprites, the garbage), which
is more than any slot path can save. The line was taken out again.

Headless, `perf:move -- <place> <seat> --frames 200 --turn 0.2 --gl`, pairs run alternately:

| | today | kept buildings free |
|---|---|---|
| Halcyon cockpit, paint median (ms), five pairs | 29.0, 29.7, 28.8, 28.4, 29.9 (mean 29.2) | 25.1, 29.7, 27.8, 27.4, 28.8 (mean 27.8) |
| Halcyon cockpit, total over 170 frames (ms) | 5240, 5204, 4984, 4940, 5256 | 4390, 5201, 4905, 4852, 5060 |
| Halcyon cockpit, `world:arms` (`--prof`, three pairs) | 11.1 | 10.0 |
| Marrow cab, paint median (ms), three pairs | 15.8, 15.4, 15.5 | 15.8, 14.9, 15.3 |

So the ceiling is about 1.0 to 1.4 ms of a 29 ms headless cockpit frame (4 to 5%), about half that in
the browser, and nothing measurable from a cab, which replays about 19 buildings a frame against the
cockpit's 210. A CPU profile of the same cockpit flight agrees: `armReplay` is about 0.47 ms a frame
(profiled, so slow), `splitGroups`, the arenas' `retain` and `pickLights` 0.1 to 0.15 each.

What `world:arms` is instead, by the arms profiler (`setWindshieldProfiler(true, { arms: true })`, ms a
frame over the same flight): every building item (`@model`, 199 calls) 5.85, most of it live arms (the
ballpark 1.13, authored 0.28, the clone facility 0.24, quay cranes 0.23, the church 0.21, the pier 0.17);
marks (the lock 1.17, `aa` 0.72, `lot` 0.54, the statue 0.46, camps 0.43, the yacht 0.36); and the tile
loops (road 0.68, badlands 0.59, redrock 0.47, parkland 0.29, park 0.28). Kept replays are already cheap;
the time is in what runs live.

## Measured 2026-10-24: the occlusion pre-pass still pays on GL (`occAuto`, tried and removed)

Phase 2's first step was to skip the pre-pass on the GL path where it does nothing: the depth buffer
hides what it hid, so it seemed worth its 1.4-1.7 ms of a cockpit frame (headless, Halcyon) only for
its culls. From a cockpit it culls no building (a cab culls 10-20, and `occlude: 0` made the cab
0.7 ms dearer), and skipping it saved about 1.5 ms of a moving cockpit frame. It was taken out again,
because the field does more than cull buildings:

- **It keeps 2-D things behind towers.** `emitDeco` queues a canvas face, so `decoHidden` is the only
  thing hiding a canvas glow (`glowPool`), a statue, a gate or a pylon (`markHidden`) behind a nearer
  building on GL. Tallied by caller over a 120-frame Halcyon cockpit flight, it said yes to
  `glowPool` 23 times; from a Halcyon cab, 1,046.
- **It culls ground objects** (`groundHidden`, 2,737 yeses over the same flight), and some of those draw
  on the canvas too. `shapes:smoke` fails when they reach the GPU from behind a wall.
- **Its near solids mask CPU-drawn contacts** (`occluderWindow`); the own ship returns before its raster.

A rule that skipped only after a pass frame in which the field hid nothing never fired at Halcyon,
moving or still, so it was complexity for nothing. ⚠ The field comes off the GL path only after the
canvas glows, landmarks and ground objects are on the depth buffer; until then it hides things nothing else does.
A first version of the tally broke `decoHidden` for a few minutes (a newline lost in an edit
commented out its `return`); every check before its removal was run again after.

## Built and measured 2026-10-24: shadow hulls kept, the interior and the canvas copies

- **`shadowKeep`** (1; 0 rebuilds every hull every frame). On the GL path a building's ground-shadow
  hull is in window tiles and depends only on its tile, footprint and the sun, and the seats take the
  hour from the server's sky context, so the sun holds still between pushes. The hull is kept per
  cell (`SHADOW_KEEP`) and its record reused, with only the alpha (the haze fade) written. Headless
  Halcyon cockpit, moving: `world:shadow` 0.81-0.84 to 0.16 ms, paint 29.7-30.6 to 27.9-29.0 ms;
  `perf:alloc` 1.1-1.8 MB a frame less (cockpit 23.75 to 21.92 MB). `perf:exact shadowKeep` is
  identical over 60 views, but its views never move the sun with shadows up (13h, or 22h with the
  sun down), so a scratch check painted 10h, 14h, 10h and 8.5h at three offsets in four seats: equal
  hull for hull, and a key without the sun's terms fails 24 of 48 frames. `recentre-exact shadowKeep`
  matches over 200 frames at Marrow (cab, `--churn 40`). At Halcyon (cockpit) it flags 8 of 200 frames;
  the one hull that differs in frame 21 has one extra vertex on the old path, (26.718, 2.345), which
  lies on the line between its neighbours. ⚠ Compare hulls canonically: a hull recomputed at a camera
  offset an ulp away can keep or drop a collinear point, so the old path does this to itself.
- **The cockpit interior** wasn't changed. It's already slot-cached (`CAB_SLOT`: an unchanged face
  pushes last frame's record after one compare, and gl/solids.js uploads incrementally). What's left
  is `sweep:interior`, about 1.8 ms headless in a cockpit, spread over 5,000 trivial iterations.
- **GL-to-2-D copies**, measured in the Modelshop at 1280x720 by wrapping `drawImage`: four full-frame
  copies a frame, about 2 ms of CPU. Three (sky, world, cloud deck) cost 0.03-0.07 ms each. The fourth,
  the cabin interior (`GL_INTERIOR_HOOK`, after the 2-D glass), costs 1.6 ms, and skipping it took a
  Halcyon cab frame from 16.8-18.9 to 15.5-16.4 ms. It comes after the windscreen rain on purpose, so
  removing it means compositing the glass in GL (the one-canvas step), not a quick fix.
- **Not done:** pooling the occluder quads (`boxQuads`, 1.3 MB a cockpit frame). It means reworking the
  depth raster's point format for about 1-2% of a frame, and the occluder raster is meant to come off
  the GL path altogether.

## Built 2026-10-24: the ground stops re-packing (`groundGPU`, `groundKeep`)

"Still to do" item 3. A replayed road tile (`GROUND_TILE`) still cost every frame: each record's
alpha rewritten with the tile's far fade, each kerb line rebuilt at a width solved from distance,
every record pushed into `GROUND_MESH`, and gl/ground.js splitting, triangulating and writing all of
them, about 6,500 records from a cockpit at Halcyon.

- **`groundGPU`** (1; 0 is the old path): a replayed tile goes into `GROUND_MESH` as one block object,
  kept on its cache entry, at the place its records went. gl/ground.js writes a block's floats once
  (`blockFloats`, one array per draw range, cached on the block) and copies them. The two camera terms
  go with the list as numbers (`GROUND_MESH.gt`): the vertex shader works out the fade,
  `blend · clamp((far − f) / 6)` with f the tile centre's forward distance, and moves a kerb vertex out
  along its line's normal by `clamp(kerbK · max(f, 0.2), 0.004, 0.05)`. The CPU still makes every cull
  and the `tileA > 1e-6` test, so the same tiles reach the GPU. A vertex is 14 floats now (tile centre
  and kerb normal); a vertex with no tile carries `NO_TILE` and draws at its own alpha.
- **`groundKeep`** (1): a block's floats stay on the GPU, one `createArena` per draw range, and only
  tiles new to the view are sent. Each range draws its kept tiles and then the streamed quads (dynamic
  tiles, shadows, the headlight pool), where the stream kept the list's order; tiles don't overlap, so
  it shows only where two translucent quads of different tiles meet. A recentre builds every block
  again (they're in the window's frame).

Headless, `perf:move -- halcyon <seat> --frames 200 --prof --turn 0.2 --gl`, two runs each:

| | cockpit paint | cockpit world:gl | cab paint | floats written (cockpit) |
|---|---|---|---|---|
| both 0 | 32.1, 34.2 ms | 11.2, 11.7 | 22.5, 24.1 | 1.15M |
| groundGPU | 29.5, 30.9 | 8.5, 8.9 | 21.5, 20.2 | 1.15M |
| + groundKeep | 28.0 | 8.0 | | 743k |

The wider vertex costs the streamed half; kept tiles more than pay it back (about 975k floats a
cockpit frame before either switch, at 10 floats a vertex).

**Proved:** `expandGroundBlocks` (windshield.js) is the shader's sums on the CPU, and `perf:exact` and
`recentre-exact` now expand a ground list through it before comparing. `perf:exact groundGPU` is
identical over 60 views; a fade off by 6 → 6.01 fails 5 of 8 views and a kerb 1% wide fails 8 of 8.
`recentre-exact groundGPU` matches over 600 frames (Halcyon cockpit, Marrow cab, Marrow cab with
`--churn 40`, 19 recentres).

**The picture,** in the Modelshop (real WebGL2), one shot per `__glRefShots` call, the switch's 0 run
twice for a control and then the switches on, pixels moved by more than 3 levels:

| shot | 0 vs 0 | `groundGPU` alone | both on |
|---|---|---|---|
| Marrow air noon | 0.06% | 0.06% (139 px) | 0.23% |
| Marrow air night | 0.05% | | 0.14% |

So the shader draws what the CPU did, and kept tiles' new order within a range moves about 0.1-0.2%
of an aircraft frame. ⚠ A full sixteen-shot `__glRefShots` run is no control for this: each shot
follows the last one's history, and two runs at 0 put Marrow air noon 13.7% apart at that threshold.
Compare single shots run back to back.

## Built 2026-10-24: the phone tier's CPU half, and a dial that knows it's CPU-bound

`PHONE_TIER` only turned off GPU passes, and the frame is CPU-bound, so a phone (three to five times
slower JavaScript) kept the whole CPU bill. It now also takes the card deck for the cloud volume, no
moon shadow pass, `govWindowGL`, `lodNear` 14, nearer glow and bloom rings, fewer birds, a world
backing store capped at 1.5 device pixels a CSS pixel (`dprMax`, new), the painted dash at 2
(`dashDprMax`, new) and `pace30`. With the tier on a desktop, a Halcyon aircraft frame went from 44.8
to 35.9 ms, and the card deck took it to 31.3 (Modelshop `__glWhere`, 960x540, a loaded machine, so
ratios only). Nothing here is measured on a phone yet.

The resolution dial read only the frame interval, so at 30 fps it pulled the backing store toward its
floor, which costs sharpness and buys about 6% on a CPU-bound frame. With `resCpu` (1; 0 is the old
dial), when the paint's own CPU time (PACE's `work`) is over 70% of the interval, the dial holds
native resolution; supersampling still waits for headroom, and a frame whose time is spent elsewhere
(the GPU, the sim) drops as before. Headless, a still cockpit painted back to back on the real clock
with `resFloor` 0.6: 384 to 512 px wide with 0, 640 with 1.

## Built 2026-10-24: a still camera keeps (`armStill`)

A kept set needed a second probe at a camera pose that had moved (`ARM_GAP` frames on), and a parked
cab or a standing free camera never moves. So a still seat ran every building live and probed each
one (three arm runs) every 12 frames: still seats were the dearest seats there were. Headless
Halcyon, `perf:move -- halcyon <seat> --frames 200 --prof --speed 0 --turn 0 --gl`:

| seat | armStill | paint median | world:arms | kept |
|---|---|---|---|---|
| cab | 0 | 31.4 ms | 15.4 ms | 0 |
| cab | 1 | 25.3 ms | 7.4 ms | 10 |
| cockpit | 0 | 48.4 ms | 25.6 ms | 0 |
| cockpit | 1 | 44.1 ms | 15.2 ms | 43 |

At one pose a recording is the live draw, so two probes there that agree (each with its clock tests
passed) keep the building at that pose (`e.kept.still`). The first frame the pose moves past the
usual 0.02, it's recorded once more and compared, as a recheck is: the same and it's kept for good,
different and it goes live with that frame's draw, and its type joins `ARM_POSE_SUSPECT`, which never
keeps while still. At most `ARM_STILL_MAX` (6) confirm a frame; until it's confirmed, or while it's too
near to record, a moved building runs live, so nothing draws from a set that wasn't proved at the
current pose. `armKeepStats.still`, `stillConfirm` and `stillWait` count them.

What's left in a still seat's arms is the buildings within `ARM_NEAR + 2·fh` (about 11 a frame at
Halcyon), which never probe, and the live ones. `perf:armkeep` flies three still-then-moving flights
now (`still`, then turning; `stillfly`, then straight) and all ten flights match the live draw;
`perf:exact armStill --layers` and `perf:retain` pass.

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
   through dusk and on each step of the resolution dial. *Measured 2026-10-26, and smaller than it
   looks.* Every seat takes its hour from the server, which sends whole game minutes (`timeScale` 1
   to 3), so `night` changes at most once every 20-60 real seconds, and only through dusk and dawn
   (it's clamped at 0 and 1 otherwise). One change, Halcyon cockpit moving, hour stepped by 0.05 every
   60 frames against held: paint 22.29 and 20.79 against 19.95 and 18.17 ms (CPU wall), probes 3.1
   against 1.3 a frame. So each change costs about 150 ms spread over the next second, which is about
   0.1-0.4 ms a frame averaged over dusk. Rounding `night` in the key isn't exact on its own (the arms
   read it continuously, so a kept set would replay a glow from another band); exact means the arms
   draw with the rounded value too, which steps the dusk light. A one-recording re-key for a
   night-only change is exact only if no arm adds a camera-facing part at night. Left as it is.
   `_frameDpr` re-keys only when the resolution dial steps, which needs the live game to count.
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
