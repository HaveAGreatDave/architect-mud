# GLASS frame headroom

**Status: Stage 1 started (the bench fixed, per-frame GL state queries removed); the 2026-10-01 record caches built (below); Stage 1b started; Stages 2-3 design.** The vertex-animated layers it follows from are built (actors,
birds, cloth; see [glass-notes.md](../reference/glass-notes.md#vertex-animated-layers-actors-birds-cloth)).

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

## Stage 3: retained static buffers

- Once a building's records are cached they don't change, so they don't need re-uploading. Give each
  cached building a range in its layer's stream and write it with `stream.writeRange` (it exists and
  nothing uses it) only when the cache entry changes.
- Most records carry a pixel size the caller worked out from distance (`clamp(k / f)`), which is
  the camera dependence that forces a rebuild. Move it into the vertex shader: pass `k`, `lo` and
  `hi` per record, compute the size from `clip.w`, and multiply by a `uDpr` uniform. Every size has
  to keep going through the single DPR funnel (glass-notes "DPR").
- Sprites, strokes and decals first. Clouds, billboards and ground need their alpha fades and sorts
  moved off the CPU first, and are last.
- (2026-10-01) Solids carry CPU fog (`fogTint`) in their colour, which changes with distance and
  heading, so a retained solids range rewrites itself every frame; the attempt for hoodoos gained
  nothing. Move that fog into the solids shader (it already fogs by `clip.w`) before retaining them.
  The own ship's sun term moved the same way and that range now sends almost nothing.

## Also measured, not yet staged

- **The occlusion pre-pass** (`world:occlude`, about 3 ms in the cockpit) re-projects every
  building's boxes every frame (`boxQuads`). Cache each building's occluder corners per map window
  and only project them, or cull with last frame's GPU depth read back small.
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
