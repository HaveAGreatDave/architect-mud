# Occlusion on foot: the GPU says what's hidden, the CPU stops sending it

**Status: phase 0 (the census) built and decided: go. Phase 1 built (the readback and its test, behind `gpuOcc`; the minimap view is still to do). Phase 2 built (Lite's records skipped behind `gpuOcc` 2; little saved alone). Phase 3 built (lamps, signals, the street kit and people; 5 to 8 ms of paint saved inside the clone facility). Phase 4 built: on by default for the street and the cab, off in the air. Phase 5 is design.**

This is [gl-core.md](gl-core.md) phase 2 step 6, aimed at the street on foot first, where [sixty-fps.md](sixty-fps.md) found the frame goes.

## Why

The street on foot costs about 22 ms of CPU a frame on the `marrow-foot` route (RTX 2070 SUPER, Lite), against 15 for the cab. None of the GPU effects is the cost; turning each off moves `world:gl` by under 1 ms. The cost is the scenery in the view cone: about 4,600 loose records streamed a frame through `uploadSolids`, most of them on tiles a walker can't see, because from 1.6 m up a street you see the first row of fronts and almost nothing behind them.

GLASS Lite has no occlusion. The CPU occluder (`world:occlude` in windshield.js) is skipped under Lite, and with Lite off it doesn't help on foot either: it culls 1.7 buildings a frame on `marrow-foot`, and turning it off moved CPU p50 from 33 to 35 ms. It's conservative by design (a coarse field, each occluder the bulkiest third of its building shrunk by 14%, each occludee grown by 22%), so from eye height almost nothing passes its test.

The GPU already has the true answer: the depth buffer, every frame. The GPU is also mostly idle (600 to 900 MHz of 2130, 22 to 43% busy, measured in the game on Marrow).

## The idea

Each frame the GPU reduces its depth buffer to a small max-depth pyramid and copies the coarsest useful level (about 64 by 40) into a pixel-pack buffer behind a fence. A frame or two later, when the fence has signalled, the CPU reads it without waiting, as `murmur-gpu.js` already reads the starlings back. The CPU then tests each tile's box against that small depth image, using last frame's camera. A tile wholly behind what was drawn is hidden, and the sweep skips the work for it: its Lite records, its street furniture, its people.

The mass stays as it is. It's one cached buffer the GPU draws for nearly nothing, and the depth it writes is what does the hiding. Only the per-frame CPU work for a hidden tile stops.

## The rules

- **Never wait on the GPU.** No `readPixels` on the frame's own depth, no `getQueryParameter` without `QUERY_RESULT_AVAILABLE`. With no fresh answer, everything is visible.
- **Visible by default.** A tile with no answer yet (new, just recentred, the camera jumped or turned more than the late frames cover) is drawn.
- **Hidden is earned, visible is instant.** A tile is skipped only after it tests hidden on two answers running, and drawn again on the first answer that says visible. The box is grown by the camera's movement since the answer was made, so the late frame can't pop a building in.
- **What depth decides must be in depth.** Occluders are the mass and the solids that write depth. Glass, glows, sprites and fading tiles don't occlude.
- **What isn't seen from the eye can still be seen another way.** The mirror on wet roads, sun shadows and the near shadow cascade see from elsewhere. A tile inside the mirror's reach on a wet frame, or casting into the near cascade's box, isn't culled until each has its own answer.
- **One switch.** `RENDER_TUNE.gpuOcc`, off until each phase has its numbers; 0 is the old path exactly.

## Phases

0. **Census.** Before any culling, measure what there is to win. With the pyramid read back, count per frame the tiles in the view cone that are hidden, on `marrow-foot`, `marrow-cab` and `halcyon-air`, and the records and ms their emitters cost (`__solidsTally`, the profiler's `world:*` phases). If a walker's hidden share is under about a third, stop here and write down why.
   - **Buildings, measured 2026-11-24** in the Modelshop (RTX 2070 SUPER, 640×360), Lite off and `occCache` 0 so the CPU occluder runs on every building, once as shipped and once with full boxes (`OCC_K` in windshield.js set to `{ shrink: 0, grow: 0, detail: 1, segMax: 99 }`). `counts.occTested` is the buildings on screen the pass tested a frame, `counts.culled` those it hid:

     | Route | On screen | Hidden as shipped | Hidden, full boxes |
     |---|---|---|---|
     | `marrow-foot` | 20.6 | 1.7 (8%) | 5.1 (25%) |
     | `marrow-cab` | 19.3 | 1.8 (9%) | 4.6 (24%) |
     | `halcyon-cab` | 18.9 | 1.6 (8%) | 3.8 (20%) |
     | `halcyon-air` | 28 | 0 | 0.1 (0.4%) |

     A quarter of the buildings in view are hidden from the street, none from the air. It's a floor: the field still takes each building's boxes only, at 5-pixel cells with `OCC_BIAS` 0.35 of slack. The air is out: occlusion is for the street.
   - **Ground objects, measured the same day the same way**, through `groundHidden` (the signals and the ground scatter; street lamps skip it on GL) with `setGroundTally` counting its answers over each whole run:

     | Route | Probes | Hidden as shipped | Hidden, full boxes |
     |---|---|---|---|
     | `marrow-foot` | 101,030 (about 168 a frame) | 40% | 51% |
     | `marrow-cab` | 46,466 | 37% | 46% |

     **Decision: go.** Half of what stands at street level is hidden from a walker, past the one-third bar, and it's what the street on foot streams most of (street-level metal 12 to 20 tiles out, `__solidsTally`). Under Lite, which players get, none of it is tested: the CPU occluder's field is built only with Lite off, so `groundHidden` answers no for everything. Phase 1 next.
1. **Built 2026-11-24, but for the minimap view: the readback and the test agree.** `gl/occ-readback.js` reduces the SSAO prepass's depth (gl/ssao.js `onMassDepth`, right after the mass and before vehicles, people and tents go in) to 64 by 40 cells, each its block's farthest depth packed in RGB, copies it into one of three pixel-pack buffers behind a fence, and `poll` takes the newest signalled copy at the top of the next frame (`occPublish`, `occAnswer` per view). `RENDER_TUNE.gpuOcc` turns it on; it needs `glSsao` or `glInk`, which every desktop tier has. The option goes through gl/install.js's key-by-key list, or it never reaches the pass. In the game on Glacier Street it asked 52 times and got 49 back with one in flight, and nothing waited. The windshield's census (`gpuOccCensus`, `counts.gpuB/gpuBHid/gpuG/gpuGHid/gpuNoAns`), facing the Golden Goose's front from Glacier Street, counts 100 of 302 ground tiles hidden a frame (33%) and the one building on screen behind it, with an answer every frame. Tile by tile, the boxes behind the front come out hidden and those beside it, straddling the eye or off screen don't. A first count looking up the open street hid none, which was right for that view, not a bug. Phase 1 skips nothing, so the picture can't change. Still to do: the minimap view of hidden tiles. ⚠ The route bench can't test this: WebGL never changes a fence's status inside one task, and `__benchRoute` paints a whole route in one, so every frame there reads `gpuNoAns`.
   The plan as designed: A max-depth reduction off the depth the frame already has (the SSAO and ink prepass, gl/ssao.js), a PBO and a fence, and the CPU's test against it. A debug view colours hidden tiles on the minimap. Nothing is skipped yet.
2. **Built 2026-11-24, behind `gpuOcc` 2; it saves little on its own.** `gpuOccFrame` (windshield.js) takes the view's answer only when the roads aren't wet and the eye has moved under half a tile, turned under about 2° and kept its height and pitch since it was made (the answer carries its eye, gl/context.js); `gpuHidden` calls a tile hidden on its second hidden answer running, its box grown by how far the eye has moved, and visible on the first that says so. A hidden Lite tile's `LITE_ANY.emit` (its signs, lights and masts) isn't called. In the game facing the Golden Goose, 22 of 89 Lite tiles asked about are skipped a frame. The frame time didn't move outside its noise over two pairs (`gpuOcc` 1 against 2: p50 50 and 33 ms against 33 and 33), and the picture with it on and off looks the same. That fits the census: Lite's own records are a small part of what the street on foot sends; the street furniture is the bulk, and that's phase 3. Not built: a route-bench mode that yields between frames, so the readback can be measured there.
   The step as designed: **Skip Lite's per-tile records on foot.** `emitTile` (gl/lite.js) for a hidden tile isn't called. Measure `marrow-foot` with `gpuOcc` 1 and 0, and hold the picture with a frame comparison after the answers settle (no changed pixels outside a tile's edge in a still camera).
3. **Built 2026-11-24, behind `gpuOcc` 2: street lamps, signals, the street kit and people.** Each pass asks `gpuHidden` per tile before it sends anything: lamps and signal masts with a 0.6-tile box (`GPU_H_POST`, about 10 m, so a lamp head over a low wall stays), the street kit with 0.6 and a 1.5-tile half-width (`GPU_KIT_HALF`, a bridge reaches into the next tile), people on their tile with 0.15 (`GPU_H_PERSON`). The kit is asked after its build-ahead, so a hidden tile is still built for when it shows. The hidden-twice count is kept per tile and kind, since a lamp's box and a person's on one tile can answer differently. In the game inside the clone facility (919,903), mirror off on both sides because it was raining and a wet road turns the cull off, three pairs of `gpuOcc` 1 against 2: 208 tiles skipped a frame, loose records 4,959 to 3,733, kept group records 37,592 to 20,798, the windshield's paint 34-40 ms to 29-32, `world:gl` 23-27 to 19-21, 21-25 fps to 25-28. The picture with it on and off is the same. Not yet measured on the open street, and the route bench still can't measure it (it never yields, so it never has an answer).
   The step as designed: **Skip the rest per tile.** Street lamps, signals and the street kit, people, arms of live tiles, interiors' boxes. Each is its own commit with its own number.
4. **Built 2026-11-24: on by default (`gpuOcc` 2), for the street and the cab, not the air.** `__benchRoute(name, { live: true })` (tools/modelshop/route.js) gives the browser a task between timed frames, so the readback answers on the bench too; its numbers compare only with other live runs (on `marrow-foot` live reads CPU p50 33-42 ms against 22 in one task, because whatever else the page does lands between frames). Two pairs a route, Lite, RTX 2070 SUPER, 640×360, `gpuOcc` 0 against 2:

   | Route | Skipped a frame | CPU p50 (ms) | CPU p95 (ms) | `world:gl` (ms) |
   |---|---|---|---|---|
   | `marrow-foot` | 80 of 357 | 42, 33 against 36, 34 | 91, 90 against 73, 61 | 25, 21 against 21, 18 |
   | `marrow-cab` | 70 of 231 | 23, 21 against 27, 22 | 61, 53 against 76, 46 | 13, 12 against 23, 13 |
   | `halcyon-cab` | 61 of 232 | 34, 32 against 32, 28 | 62, 75 against 69, 56 | 19, 21 against 21, 19 |
   | `halcyon-air` | 3 of 226 | 45, 46 against 49, 43 | 96, 77 against 81, 71 | 28, 26 against 122, 24 |

   On foot the slow frames come down most. The Marrow cab's dear first run was the page, not the cull: that page had run a dozen benches, which drifts it slower (sixty-fps.md, "How each step is measured"). On a fresh page, three rounds of `marrow-cab` live, `gpuOcc` 0, 2, and 2 with the street kit left out (`gpuOccKit` 0): CPU p50 14.4, 14.2, 13.2 off; 14.5, 14.5, 14.6 on; 13.9, 13.8, 13.7 on without the kit, and p95 26.0, 26.1, 22.7; 27.1, 24.2, 30.7; 23.5, 23.1, 23.9. So in a moving cab culling the kit costs a little (its kept sets are dropped and sent again as tiles flip between hidden and seen), and the rest of the cull is about even. The kit is culled only at a walker's eye height (`GPU_KIT_EH`, 0.1 tiles), where it was most of the saving inside the clone facility. From the air almost nothing is hidden, so above `GPU_MAX_EH` (0.5 tiles, about 9 m) the frame takes no answer. The one 122 ms reading was the first run in that view and didn't repeat; the readback's program compiles on a view's first frame with it on.
   The step as designed: **The cab and the air.** The same test from a cab and a cockpit. From the air less is hidden; the census says whether it's worth it.
5. **Retire the CPU occluder on GL**, once the canvas glows, landmarks and ground objects it still hides ([glass-headroom.md](glass-headroom.md), "the occlusion pre-pass still pays on GL") are on the depth buffer.

## Inside a building

**Built 2026-11-25, not yet measured.** Walking a building in GLASS, your storey is cut out of its mass (`roomCut`), so the readback looked through the room's walls and hid almost nothing. Two fixes:

- **The rooms' walls go into the depth the readback takes** (gl/interiors.js `drawDepth`, called by context.js `occRooms` just before `onMassDepth`). Solid parts only; glass writes no depth, so a window still shows the street.
- **Only what a way out looks onto** (`apertureFrame`, `apertureHidden` in windshield.js, `RENDER_TUNE.aperture`). Under a roof (`roofed`), every pane of every room in the frame and every street door is a wedge of bearings from the eye; a tile whose wedge meets none of them skips what `gpuHidden` already skips (lamps, signals, the kit, people, Lite signs). It's this frame's answer, so it doesn't wait on the GPU and still works on a wet road. Height is left out, so it only ever keeps too much; tiles within 1.5 of the eye are always kept. The profiler counts `aperAsk` and `aperSkip`. A room whose windows aren't listed as `panes` would lose its view: turn `aperture` off to check.

## Risks

- **A late answer when the camera turns fast.** Growing the box covers a walk; a fast turn or a jump invalidates everything, and that frame draws all.
- **The readback stalls on some drivers.** D3D11 through ANGLE is the target; the fence and `getBufferSubData` path is what the starlings use there. If a fence is slow to signal, answers are older, never blocking.
- **Phones.** A float depth readback isn't everywhere; pack depth into RGBA8 in the reduction pass.
- **A hole in the city** is worse than any saving. Every phase lands behind `gpuOcc` with its frame comparison, and the minimap debug view stays for checking.

## Measuring

- `__benchRoute('marrow-foot')` with `glassLite` 1 and `gpuOcc` 1 and 0, same page; `counts` in the result has the profiler's per-frame counts, and `globalThis.__solidsTally = { sig: {}, dist: {} }` counts the records `uploadSolids` streams.
- In the game, `__footPerf(true)` and the windshield profiler on Marrow Street on foot (sixty-fps.md, step 2).
