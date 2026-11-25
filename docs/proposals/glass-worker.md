# GLASS on its own thread: the street on foot painted in a worker

**Status: phase 0 measured: on hold. Phases 1 to 4 are design.**

## Phase 0, measured 2026-11-24: the page's other work is under 1%

In the game (a guest on `test.localhost:3000`, the Browser pane at 669×742, Lite, with this day's occlusion and kept-metal changes in), walking Ironside Street outside the clone facility for 30 s with W held and five turns: 1,788 frames, 59.6 fps; `paintWindshield` 10.1 ms a frame (`__footPerf`), 18.0 s of the 30. The long-animation-frame API saw 2 long frames in all, 0.13 s, both in the street view's own callback; nothing else on the page (the socket, the log, the HUD) made one. So the page's other work is far under the 10% bar, and a worker would buy this street next to no frame rate: it already holds 60. ⚠ That's Ironside, not Marrow, where the first in-game measurement (before the day's changes) read 10 to 16 fps. Measure Marrow the same way before deciding phase 1 on frame rate; the case left for a worker is a page that never freezes behind a slow paint, which matters only where the paint is slow.

This is [sixty-fps.md](sixty-fps.md) step 7, "move the build to a worker". It's the last and largest of that plan's steps, and this is how to do it.

## What the measurements say first

- **The frame is the CPU's.** On `marrow-foot` (Lite, RTX 2070 SUPER) the GPU takes about 11 ms a frame at the median against 27 ms of CPU; no effect pass is over 3.2 ms of GPU (sixty-fps.md, "The effect passes on foot are not a lever").
- **On foot, the frame is `paintWindshield`.** The street view's own work round it (the camera and every one-world tick) is 0.2 ms a frame (`__footPerf`). In the game the main thread was busy 89% of each 3 s sample, nearly all of it the street view's frame callback.
- **The world build can't be lifted out on its own.** In windshield.js the sweep that builds the world also paints the 2-D canvas as it goes (glows, steam, lettering, the street furniture's ink), fills the GL sinks from inside drawing functions, and reads caches the same pass fills. Splitting "the maths" from "the drawing" means rewriting most of a 60,000-line file.
- **The whole renderer already runs in a worker.** `room-outlook-worker.js` paints GLASS on its own thread for the view out of a room: windshield.js loads there against a small fake `document` whose canvases are OffscreenCanvases, paints a frame per `frame` message and posts back a bitmap. It has shipped since the outlook moved off the main thread.

## What a worker buys, and what it doesn't

⚠ **A worker doesn't make the paint cheaper.** The same 25-45 ms of JavaScript runs either way. What it buys:

1. **The page stops freezing.** Text, the HUD, the tablet, sockets and audio scheduling run while the city paints, instead of waiting behind it. That's the stutter and the "Reconnected." a long paint causes (a long main-thread block drops the socket).
2. **Overlap.** The worker paints frame N+1 while the page handles frame N's input and the compositor shows it, so the view's rate is set by the paint alone, not the paint plus everything else on the main thread.
3. **A path to parallel work.** Once the paint is in a worker, the pieces that really are separable (the Lite bake's chunk decoding, the kit and mark set builds, the interiors' meshes, as `room-mesh-worker.js` already does) can go to more workers.

So expect the street on foot to stop stalling the page and to gain the 10 to 20% the main thread's other work costs it now. Not 2x. A 2x needs the paint itself to get cheaper or split, which is phase 4.

## The design

The street view's canvas goes to the worker with `transferControlToOffscreen()`, so the worker draws straight to the screen with no bitmap posted back, and paints from its own `requestAnimationFrame`. The page sends what changes, the worker paints the newest state it has.

**Sent when it changes:** the map window, skyline, roads and regions (on a recentre, transferred, not cloned); the actors and contacts (on each server push); weather, hour and moon; the interiors' room data; the tune (`RENDER_TUNE` keys that changed).

**Sent every frame, small:** the camera (`freeCam` view, eye, mapCenter and offset), and the per-frame flags the paint takes (doors' open state, the Pack camera, `roofed`, cuts).

**Sent back:** the frame's view-projection matrix and eye (for `owLate`'s pages laid on glass and `project`), frame stats for `__footPerf` and the profiler, and events the paint raises (sound cues such as `shoreAudioFrame`, GL failures for the `glHold` path).

**Queries stay on the page.** The street view asks height and collision questions synchronously every frame (`modelTopZAt`, `groundObstructionAt`, `streetKitFootAt`, `floorZAt`, `doorBayAt`). They're pure functions of the map and the models, so the page keeps its own windshield.js for them, as it does now, and only stops calling `paintWindshield`. ⚠ Their memo caches then fill on both threads: measure the memory.

## Phases

0. **Measure the page's other work.** The share of a frame the main thread spends outside `paintWindshield` on foot: the long-animation-frame API over a minute of walking, with the socket and the log busy. If it's under 10%, phases 1 to 3 buy smoothness, not frame rate; say so before building.
1. **The street on foot, outside only, behind `RENDER_TUNE.footWorker`.** The worker from the outlook's (its fake `document`, its warm start), with `transferControlToOffscreen` instead of posted bitmaps. Inside a building (one-world rooms, with their live figures, cats, vats and cookers, all functions that can't be cloned) the view goes back to the page as now, so phase 1 is the street only. Gate: the picture matches the page's paint frame for frame on a still camera (`__glFidelity`'s method), and `__footPerf` and the profiler read through.
2. **Its rough edges.** Input latency (one frame at most; the worker paints on receipt of a camera message), context loss in the worker (`glHold` and the rebuild, from there), the console's `window.__` tools proxied to the worker, and a phone (Lite, the narrower budget; OffscreenCanvas WebGL2 isn't everywhere, so it falls back to the page).
3. **The cab and the other seats.** The same worker for the cab, truck and helm views, each with its own per-frame state.
4. **The paint, split.** What can be built apart from the paint moves to more workers and arrives as typed arrays: the Lite chunks' decoding, the kit's and the marks' kept sets, the interiors' meshes. Each lands with a route-bench number, as everything in sixty-fps.md does.

## Risks

- **Two copies of the renderer.** windshield.js and the GL modules load on both threads: about twice the code memory and two sets of memo caches. Measured in phase 1 before anything else.
- **What the paint touches on the page.** Anything in windshield.js that reaches for the real DOM or `window` (the outlook worker found these as it went) answers empty in the worker; each has to arrive by message or stay on the page.
- **Debugging.** Console tools, `RENDER_TUNE` edits and the profiler talk to the page's copy by default. Every one has to say which thread it means.
- **The gates.** The smoke tests and the regress suite run the renderer on one thread; the worker path needs its own gate, or it rots.

## Measuring

- `__benchRoute(name, { live: true })` measures the paint either way; the worker changes the page around it, so the number that matters is the game's: the frame rate and the long-animation-frame share on foot, page against worker, on the same street.
- `__footPerf` and the windshield profiler, read from the worker.
