# GL core: one library under every renderer, then one host

**Status: phase 2 started (signal masts and heads kept on the GPU); phase 0 started (the route bench `__benchRoute`, GPU time per pass on GLASS, ROOM, the ballpark and the rink, and the first desktop baseline); phase 1 started (`gl/core/mat4.js`, `gl/core/glsl/tone.js`, `gl/core/timer.js`, and the `core-lint` ratchet); phase 3 started (the sun's near cascade, `glShadowNear`, and bloom and SSAO in ROOM, `gl/room-post.js`); phases 2 and 4 to 6 are design.**

## Why

The game draws in 3D in five places, and each grew its own renderer: GLASS (the city, `gl/context.js` and `gl/world.js`), ROOM (`gl/room.js`, which also draws the kitchen, the chem lab, the broadcast sets and the cats), the ballpark (`gl/ballpark.js`), the rink (`gl/arena.js`), and the smaller views (`gl/approach.js`, `under-view.js`, two WebGL1 overlays). Each owns a WebGL2 context, so a room with a window and a TV on the wall runs four or five at once against a browser cap of 16. And each carries its own copy of the same parts:

- the ACES tone curve, six times (`hdr.js`, `room-light.js`, `ballpark.js`, `broadcast.js`, twice in `approach.js`)
- matrix multiply, invert, perspective and look-at, in about eight files
- shader compile and link, in about a dozen
- context loss, handled six different ways
- GPU timing, in GLASS only

A fix to one copy reaches one view. ROOM has no shadows, no HDR target and no SSAO, while GLASS has all three, because they were written into GLASS rather than beside it.

The other half is cost. GLASS 2 is CPU-bound: building the world is most of a frame, and the GPU is mostly idle (glass-notes.md). Every number in the repo was measured on one desktop with a discrete NVIDIA card. Nothing has been measured on a phone, and this desktop's Ryzen 3600 has no integrated GPU, so "an iGPU" means another machine.

So the order is: measure on weak hardware, move the shared parts into one library, cut CPU work, then spend what that frees on lighting, textures and detail. Textures stay procedural.

## Phase 0: measure (started)

**Built:**

- `__benchRoute(name)` and `__benchRoutes()` on the Modelshop (`tools/modelshop/route.js`). The routes are in `tools/modelshop/routes.js`: drives along real roads, and one flight, at a fixed speed. Each route is run warm, then with a GPU timer round every paint, then with the per-pass timers. It reports CPU p50/p95/p99, GPU p50/p95/p99, GPU ms per pass, the windshield's phases, the heap, the GPU's name and the render dials. A moving camera pays for the map window moving under it, which `__glWhere`'s turning camera never sees: on the Marrow drive the CPU median was 19 ms and the 99th percentile 168 ms.
- `gl/core/timer.js`: one GPU pass timer for every renderer on the page. GLASS reports its passes as before (`glPassTimer` is now this), ROOM reports `room`, the ballpark `park` and `parktv`, the rink `rink`.
- `scripts/perf/baselines/<device>.json`: one file per machine, the output of `__benchRoutes()`. `scripts/perf/baseline-schema.mjs` (a gate) checks each parses and names only routes that exist.

**Still to do:**

- a phone baseline. The Modelshop doesn't run on a phone, so a phone is measured with `__glassBench()` in the game over USB DevTools, one seat at a time, until there's a route bench in the game client.
- an integrated-GPU baseline, on a laptop.
- `PHONE_TIER` (`windshield.js`) retuned switch by switch against those numbers. Nothing in it has been measured on a phone.
- routes for ROOM and the venues.

## Phase 1: the shared library, `gl/core/` (started)

| Module | Holds | State |
|---|---|---|
| `core/mat4.js` | multiply, invert, perspective, lookAt; optional `out`, safe when `out` is an input | built; gl/camera, rink/camera, diamond/camera, kitchen, taa, cloudvol, lampshadow, spotshadow, approach, room and room-people use it |
| `core/glsl/tone.js` | `ACES_GLSL`, `OETF_GLSL` | built; hdr, broadcast, approach, ballpark and room-light use it |
| `core/timer.js` | GPU time per pass | built; GLASS, ROOM, ballpark and rink use it |
| `core/program.js` | one compile and link over `takeWarm`, absorbing `programs.js` and the private copies | design |
| `core/texture.js` | `texture2D`: a 2-D texture with its filter and wrap; sRGB uploads, mips and texture arrays to come | started; room-post uses it |
| `core/target.js` | colour and depth targets, MSAA and resolve, RGBA16F with an RGBA8 fallback | design |
| `core/lost.js` | one loss and restore protocol | design |
| `core/mesh.js` | the ballpark-mesh STRIDE-12 batch and MAT table as the shared small-mesh format | design |
| `core/post/` | hdr, ssao and mirror, with each view's numbers passed in | design |

**Still on their own copies:** only `room-people.js`'s `inv4`, which is an affine-only inverse and stays. `diamond/camera.js`, `room.js` and `room-people.js` moved their matrix sums onto `core/mat4.js`, and `ballpark.js` and `room-light.js` their ACES onto `core/glsl/tone.js`, on 2026-11-16; the diamond copies are frozen in the gate.

**The rules:**

- A renderer moves one piece per commit, and draws the same picture after. `scripts/shapes/core-mat4.mjs` holds `core/mat4.js` to the copies still in the tree and to the retired ones, bit for bit. When a live copy goes, move it into the gate's frozen block; don't drop the check.
- `lampMatrix` and `spotMatrix` now take their angle in radians, not a round trip through degrees, and agree with the old result to a part in 10^12.
- `scripts/gl/core-lint.mjs` counts the copies left outside `gl/core/` per file (ACES, local matrix functions, `gl.createShader`, `TEXTURE_MIN_FILTER`, `webglcontextlost` listeners) against `scripts/gl/core-baseline.json`. A count may go down, never up. After moving a copy, run it with `--update`.
- One call site per big GLSL function. Inlining one five times once crashed the D3D GPU process.

## Phase 2: GLASS's CPU budget (started)

Most of a frame is JavaScript building the world. [sixty-fps.md](sixty-fps.md) is the plan for this phase aimed at one target, 60 fps in a cab on Marrow Street, with where the frame goes today. In order:

1. Pool the top allocators (`emitWire`, `emitDecoFill`, `signalHead`) and lower `scripts/perf/alloc.json`. Started 2026-11-16: decal keys and the signal lens colours are made once, and a signal mast's steel is built once and kept on the GPU (`MAST_SETS`; `RENDER_TUNE.mastKeep 0` draws it live). It rides on a stroke's world width, `wr`, which `gl/strokes.js` sizes from the vertex's own depth; `scripts/perf/sizes.mjs` checks it. A signal head's housing is kept too (`HEAD_SETS`, `RENDER_TUNE.headKeep 0` for live): both lens faces, both flanks and both sets of visors, all writing depth, so the depth buffer hides the far ones instead of the camera choosing; one set per detail tier. Its lenses, strip, glow and keyline stay live. The cab went from 10.38 to 9.47 MB a frame; the cockpits draw their signals too far off to keep and read the same, within the 2% the runs vary by. The yacht's faces, in her own frame, are built once per light (`YACHT_FACES`) instead of twice a frame: the Halcyon cockpit went from 18.77 to 18.09 MB a frame. Indexed loops in place of `for…of` in `armRecord`, the occluder bounds and the two ships' face loops took it to 17.78. The rest of the iterator garbage is spread over dozens of sites at under 0.05 MB each. She can't go into the Lite bake, because she sails and rides the swell. Most of what's left in those three functions is the records themselves, which can't be pooled because arm recording keeps them; keeping them is the way down.
2. Bake what still runs live into GLASS Lite: the static parts of the marks (the lock, AA, the lot, the statue, the camps, the yacht), the ballpark arm's still half, and the road, badlands and redrock tile loops. glass-headroom.md measures these at about 4 ms of a headless cockpit frame.
3. Pack the mass vertex from 100 bytes to about 40 (oct normals, unorm8 colour, uint16 uv) and index the quads. That halves upload and memory.
4. An instanced variant of the mass shader for the street kit's repeats (lamps, signal heads, trees, parked cars).
5. A coarse LOD per Lite chunk for the cockpit, which draws about 210 buildings to a cab's 19.
6. GPU occlusion from a depth pyramid, read back a frame or two late, which would also give Lite occlusion. Planned for the street on foot first in [foot-occlusion.md](foot-occlusion.md). Glows, landmarks and ground objects have to be on the depth buffer first.
7. Backface culling for closed groups.

Each lands with a route-bench number.

## Phase 3: lighting (started)

1. Linear light everywhere and one tone curve: glass-materials.md steps 3 and 4 for water, solids, decals, clouds and billboards.
2. **Built: the sun's near cascade (`RENDER_TUNE.glShadowNear`, 5 tiles, off on phones).** The whole-window map stays as it was. A second 2048 map (`shadow.js`, a second layer) covers the tiles within 5 of the eye, stretched toward the sun by the tallest caster's shadow so a tower outside the box still casts into it (`world.js` `nearShadowBox`). It's snapped to whole tiles, so it's redrawn only when the eye crosses one, and then only the runs inside its box are sent (`context.js` `nearPass`). The city shader (`sunShadow`) takes the near map where it covers and blends to the far map across the outer tenth of its box, so there's no line where shadows sharpen. Unit 13. It keeps the hand-written PCF; the hardware compare sampler saturates through ANGLE (`shadow.js`).
   - Measured 2026-11-15 in the Modelshop with the clock pinned: a Halcyon cab at 9:30 moves 1.0% of the frame (mean 5.9/255), Marrow at 16:30 0.7%; two renders with the same setting move 0%. The change is at shadow edges on the buildings near the eye, which come out cleaner; no seam at the box edge, and no acne. A redraw is about 2.4 ms of GPU.
   - Still to do: a third cascade for the aircraft seats, and the near map for the solids and the cabin (`worldSun`), which still read only the far one.
3. Ambient from the sky: spherical harmonics from the env cube in place of the two-colour ambient.
4. Clustered lights with specular (`core/light/cluster.js`), grown from `lightgrid.js`, in place of the 16 wall slots. The ballpark's towers and the rink's five lights move onto it.
5. ROOM through the core. One-world interiors' lighting (phase D of [its conversion](one-world-interiors.md#the-conversion)) is then the same code.
   - **Built: bloom and SSAO (`gl/room-post.js`, `ROOM_POST`, on; off on phones).** The room's colour and depth go through the ballpark's depth-only SSAO (`ssao.js` `createDepthSSAO`, half size, 0.4 m reach) and a bright-pass bloom at half and quarter size, then one composite: the scene times the occlusion, plus the bloom, coverage kept. Under the lens it works on the lens's resolved target (`room-dof.js` `finish({ grade })`) before the blur; without the lens the room draws into its own target. Display values, like GLASS's bright pass, because several room outputs (fire, screens, glows, shutters, mirror) skip `finish()`.
   - Measured 2026-11-15 in the Room Lab (Solenne salon, clock pinned): with both terms at 0 the frame is identical to the pass off, lens on or off; the occlusion moves 15% of the frame (mean 12/255) and the bloom 1%. About 0.2 ms of GPU a frame at 964×740.
   - Still to do: lamp shadows (`spotshadow.js` maps for the two or three strongest lamps, and one for the sun through the panes), which means touching `ROOM_LIGHT_GLSL` and so the figure's shader too; and true linear HDR (`uStreet` 3 on the room's programs, with the outputs above turned back from display values). `ROOM_LIGHT_GLSL` moves to `core/light` with the shadows.
6. A gate on shader size after includes. Cold compile through D3D is already 35 s for the ballpark and over a minute for the figure.

## Phase 4: procedural textures (design)

1. Move the GLASS atlas into texture arrays by size class. Mipmaps then stop bleeding between surfaces (why the atlas has none today, `context.js` `textureLod(..., 0.0)`), REPEAT works, and the ceiling of about 872 surfaces goes. Magnification stays NEAREST so signs stay sharp.
2. A higher texture resolution on desktops, painted in a worker.
3. Tiling detail and normal maps per material family, painted in code, faded with distance.
4. Triplanar grime in world space (`core/glsl/grime.js`), masked by AO, height and up-facing surfaces, shared by GLASS, ROOM, interiors and the venues.

Nothing is downloaded, so it costs no egress.

## Phase 5: detail (design)

Spends what phase 2 saves: instanced clutter and planting with wind, puddles from the env cube, skyline LOD, one-world steps 2 and 3 (rooms behind facade windows, the shell round loaded rooms), and the street people's GPU pose, instancing and impostors (street-people-ladder.md steps 4 to 6). Each lands only with a route bench showing it fits on the weakest measured device.

## Phase 6: one GL host (assessment)

**What it would be.** One WebGL2 context per page (`core/host.js`) holding the program cache, the shared atlases and a list of views, each a camera, a target and its passes. The window view and a TV feed draw into textures in the same context, with no copy through a 2-D canvas. Panels show their view through `transferToImageBitmap` into a `bitmaprenderer` canvas, a path `windshield.js` already uses.

**What has to be true first:**

- Phase 1 done: every renderer builds through `core/program`, `target` and `lost`.
- No renderer draws to the default framebuffer.
- A state tracker (`core/state.js`) with a debug mode that catches one view's blend, cull or bindings leaking into the next.
- Resources tagged by owner, so a view can be thrown away whole.
- One restore path that rebuilds every view after a loss.

**In order:**

1. The TV feed: the ballpark and rink already build everything on a context they're handed, so they can draw into ROOM's.
2. The window view: `createGLView` takes the host's context. The phone's worker keeps its own, since an OffscreenCanvas context can't be shared across threads.
3. ROOM inside GLASS, which is [the one-world conversion](one-world-interiors.md#the-conversion).
4. The venues as views.
5. One canvas for the page.

**Risks:** one loss now takes every view down; a heavy venue frame stalls the room; a state leak shows as wrong colours, not an error; first-open compile time; each panel's own DPR; Safari's `bitmaprenderer`.

**Verdict: moderately hard, about as big as phases 2 and 3 together.** The GL itself isn't the hard part. Keeping ten renderers that grew apart from leaving state behind for each other, and owning and restoring their resources, is. Phase 1 does most of that work anyway. What it buys is memory, room under the 16-context cap, no TV-feed copies and one compile per page; it doesn't make the main view faster. Do steps 1 and 2, measure memory and compile time on the phase 0 devices, and only go on to step 5 if those numbers ask for it.

## Measuring

- `__benchRoutes()` on the Modelshop, then `copy(JSON.stringify(result, null, 2))` into `scripts/perf/baselines/<device>.json`. Compare a run only with a baseline from the same device.
- A/B: interleave tabs and reload between configs (glass-notes.md), and keep the minimum of several reps.
- `perf:move --gl --lite` for the CPU of a moving camera without a browser.
