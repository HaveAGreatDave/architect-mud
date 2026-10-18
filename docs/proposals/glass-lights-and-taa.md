# GLASS 2 clustered lights and TAA

**Status: A1 started (the light grid and the wet road, behind `glCluster` 0, 2026-10-17; see
[A1 as built](#a1-as-built-2026-10-17)); B and A2 are design.** Two pieces of work for GLASS 2, each behind a `RENDER_TUNE` switch
whose 0 is today's picture: a clustered light list that lifts the per-frame light cap, then a new
short-reach light from each sign onto its own wall (`glCluster`); and temporal anti-aliasing
(`glTaa`). Both stay on WebGL2. Neither needs WebGPU: the light list goes in data textures, and TAA
needs only the float target [gl/hdr.js](../../client/game/js/panels/gl/hdr.js) already has.

Paths below are relative to `client/game/js/panels/`.

## Where it stands (2026-10-17)

**Lights.** GLASS 2 has GPU point lights, but `pickLights` (gl/world.js) hands a frame at most
`glLightSlots` of them, 16 by default, out of a compiled ceiling of `MAX_LIGHTS` 32 (gl/context.js). A
dense night frame has 120 to 400. Every other consumer has its own lower cap:

| Consumer | Uniforms | Cap |
|---|---|---|
| gl/context.js, the mass | `uLightP`, `uLightC`, `uLightRaw`, `uLightR`, `uLightLR` | 32 (16 used) |
| gl/ground.js, gl/floor.js, the wet road | `uWetP`, `uWetC`, `uWetR` | `MAX_WET` 6 |
| gl/water.js, the sea | `uNeonP` | `NEON_MAX` 6 |
| gl/actors.js, cloth.js, solids.js, billboards.js | `uWLP`, `uWLC`, `uWLR` | 12 |
| gl/decals.js, lit cloth | `uLitP`, `uLitC`, `uLitR` | `LIT_MAX` 12 |

The cap is why the list is ranked, why `LIGHT_HOLD` exists and why `fadeLights` ramps a slot in and out
over a third of a second: without the ramp a light swapping slots moved 1,654 pixels in one frame. The
uniform budget stops the cap going much higher, since past 56 lights a floor-spec device gets no GL pass
at all (see the note over `MAX_LIGHTS`).

The wall wash is `LIGHT_TUNE.gain` 0. It was cut six times on reports that it read as a light show over
the facade, and at the shopfront it was reported from it made the lettering on Nuts to That
unreadable. So the mass gets the list only for the night lift, the wet lobe and the light shafts.

**Anti-aliasing.** MSAA is on (`glMsaa` 1) and resolved by `blitFramebuffer` in gl/hdr.js. FXAA exists
and is off (`glFxaa` 0) because it smeared lettering ("CASH & CARRION"). Shader aliasing, which MSAA
doesn't touch, still shimmers: thin mullions, distant window grids and highlights.

## Order

| Stage | What | Switch |
|---|---|---|
| A1 | Clustered light list for every consumer | `glCluster` |
| B | TAA, with signs drawn after the resolve | `glTaa` |
| A2 | Sign-to-wall light | a `LIGHT_TUNE` key, 0 |

One at a time: all three edit `glWorldPass` in gl/world.js. Each lands at 0 and is switched on after
the benches. A2 goes last because it's tuned by eye, and TAA changes what a lit wall looks like in
motion.

## A1: clustered light list (`glCluster`)

**The grid.** A new `gl/lightgrid.js` takes the candidate list `pickLights` builds before it ranks and
slices (the same cull and the same per-light fields, uncapped and unfaded), and bins it on the CPU into
a froxel grid: 16 by 9 screen tiles and 16 exponential depth slices, built from `viewProjMatrix`
(gl/camera.js). A light goes into every froxel its sphere touches at its largest reach (`r`, `rw` or
`rl`, whichever is biggest).

**Upload.** Three textures, written each frame with `texSubImage2D` from typed arrays allocated once:

- the light table, RGBA32F, a few texels per light (position and reach, `rgb`, `rgbRaw`, `rw`, `rl` and
  the wash flag), capped at 1,024 lights;
- the cluster table, RG32UI, an offset and a count per froxel;
- the index list, R32UI.

**The shader side.** One GLSL chunk, `LIGHTGRID_GLSL`, finds the froxel from `gl_FragCoord` and view
depth and walks its lights with `texelFetch`. The body of the loop stays each consumer's own maths, so
the road's reflection and the wall's lift don't change; only how many lights reach them does.

**Porting.** One consumer at a time, each keeping its uniform path for `glCluster` 0:

1. The wet road and floor (gl/ground.js, gl/floor.js). The most visible change: every sign shows in
   the puddles, where six do now.
2. The sea (gl/water.js).
3. The mass loop (gl/context.js): lift, wet lobe, light shafts.
4. Actors, cloth, solids, billboards and decals.

**Fading.** With no slots there's nothing to swap, so `fadeLights` isn't used at 1. A light that comes
in at an LOD tier still needs a ramp, and the sprite alpha `s.a` already has one.

**Failing safe.** If the device can't sample the float or integer textures, `glCluster` goes to 0 and
the uniform path runs, as every other GLASS 2 layer falls back. Nothing is left half installed.

## A1 as built (2026-10-17)

[gl/lightgrid.js](../../client/game/js/panels/gl/lightgrid.js) and the wet road in
[gl/ground.js](../../client/game/js/panels/gl/ground.js), behind `RENDER_TUNE.glCluster`, which is 0.
At 0 the road runs the uniform path it always did. The light shaft in the air still reads the six.

**The road's grid lies on the ground, not in froxels.** A streak is anchored at the mirror point
between the eye and the light, not at the light, and every road term depends on the fragment's world
x,y alone. So the road's grid is 2-D over the map window: no projection, no near plane, no height
range. The mass will still want the 3-D version.

**Footprints are sized by gain.** Every streak's mirror point sits within a tile or two of a low eye,
so with a fixed cut-off the cells in front of a cab listed nearly every light. Each term is now cut
where colour times its gain (streak 0.09 × `uWet`, glint `uGlint` × `uWet`, pool `uPool` × night)
falls under 1/512, so a dim window gets a short footprint or none. The binning is scanline
rasterising, preallocated: 6 to 9 ms a frame per cab frame with a separating-axis test per cell,
0.3 to 1.3 ms after.

**`gl:cluster`** ([scripts/shapes/glcluster.mjs](../../scripts/shapes/glcluster.mjs)) checks the
shader's expressions and gains, then over five random scenes and three weathers that every point a
light reaches is in a cell that lists it (about 335,000 pairs).

**`__glCluster()`** in the Modelshop renders the wet street with the grid off and on. It uses the
truck's chase view and reads the finished frame: from the cab seat the world pass's canvas holds the
cabin by the time a bench reads it, so wet against dry measured 0.00%. `__glWet` reads the same
canvas and is blind the same way.

**What it showed** (Modelshop, discrete NVIDIA card, 960×540):

| | Six lights | Grid |
|---|---|---|
| Lights on the road, 23:00 | 6 (pools 16) | 108 |
| Frame moved against six lights, 23:00 | | 32.5%, nearly all brighter |
| Frame moved, 13:00 | | 27.5% |
| Frame time, interleaved, median | 32.1 ms | 34.3 ms |

The extra light is the streaks, not the pools. With pools off the frame still moves 37.8% (mean 9.4
levels); pools alone on a dry night move 9.9% (mean 2.0). The streak gain of 4.5 was swept against
six lights, and summed over sixty it lays a pink sheet over the road and the pavement in place of
separate streaks. That's a look decision, the same kind as the wall wash, and it has to be made
before `glCluster` goes to 1. The options are the grid for pools only (the streak keeps the six),
or a re-tuned streak (gain or width) judged by eye for many lights.

## B: TAA (`glTaa`, needs `glHdr` 1)

**Jitter in one place.** `projMatrix` (gl/camera.js) adds a sub-pixel offset from `cam.jitter`, a
Halton(2,3) sequence of eight, set once a frame where `cam.near` is set in `glWorldPass`. Every layer
builds its own matrix through `viewProjMatrix`, so all of them pick it up. Bank and shake are applied
at the 2-D blit (`bankInto`, windshield.js) and never enter the matrix, so reprojection doesn't see
them.

**The pass split.** Signs stay sharp by never going through the temporal blend:

1. Jittered, into the multisampled float target as now: shadow, mirror, mass, solids, seabed, floor,
   water, ground, haze fade, actors, film.
2. `resolveScene` (gl/hdr.js), then the TAA resolve.
3. Unjittered, into a single-sample framebuffer over the resolved colour: light sprites, the Curtain,
   decals, strokes, billboards. Their depth is the multisampled depth blit-resolved with NEAREST into a
   single-sample attachment. They keep their clip-z nudge and lose MSAA, which costs little: their
   edges come from texture filtering.
4. Bloom, grade and FXAA as now.

**The resolve.** A new `gl/taa.js` keeps two RGBA16F history textures and swaps them each frame. Each
pixel is reprojected through its depth with this frame's unjittered inverse matrix and last frame's
matrix, the history is sampled with a Catmull-Rom filter, clipped to the 3 by 3 neighbourhood's
variance in YCoCg, and blended at 0.1. Colour is premultiplied and the sky is transparent, so alpha
goes through the same clip.

**Things that move.** Camera reprojection is right for the city and wrong for anything moving on its
own. In the first phase actors, solids and vehicles, the ownship and streetlife write a stencil bit,
and the resolve drops history weight to about 0.5 there. In the second, the ownship (its previous model
matrix, `uploadShip` in gl/context.js) and solids get real motion vectors, as the two that smear worst.

**Resets.** The history is thrown away when the canvas size changes (there's no resize signal, so the
pass compares against the last size), when the camera jumps further than a seat change or teleport
would move it, when the context is restored, and when `glTaa` or `glHdr` changes.

**Plumbing.** `glTaa` and `glCluster` go into the options `GL_HOOK` is called with in windshield.js,
and into the `gl:opts` allowlist.

## A2: a light from each sign onto its own wall

A new term in the mass loop, for point sources only (never `s.wash`). Its reach comes from the sign's
own sprite radius, so it covers about the patch of facade the sign is mounted on, well inside the tile
`wallR` gives. It's capped like `lamp`, so a wall under it is never brighter than by day. It ships at
0 and is switched on only when:

- the lettering on Nuts to That and "CASH & CARRION" reads as well with it on as off, and
- `__glLights` shows the wall pixels it moves staying near the sign.

## Checks

**Gates** (node, no WebGL, added to [scripts/gates/manifest.mjs](../../scripts/gates/manifest.mjs)):

- `gl:cluster`, new: against a brute-force test, every light is in every froxel its sphere touches and
  in none it can't.
- `gl:parity`: unchanged at jitter 0, plus a check that a jitter of j moves NDC by exactly 2j/W.
- `gl:opts`: picks up the new keys.

**Benches** in the Modelshop ([tools/modelshop/README.md](../../tools/modelshop/README.md)):

- `__glFrame`: the cluster build under 0.5 ms and the TAA resolve under 1 ms at 1080p.
- Shimmer: the frame-to-frame pixel difference with the camera crawling, TAA on and off.
- Lettering: the sign region with TAA on and off should match bit for bit, or near it.
- Ghosting: a cab passing actors and traffic, and a turn in the seat.
- A rainy street with `glCluster` 0 and 1.

When a stage is built, its notes go in [glass-notes.md](../reference/glass-notes.md) and the status line
above changes.
