# GLASS materials

**Status: Stage 0 built (2026-10-03); stages 1 to 4 design.** This is the plan for bringing GLASS 2's surface shading up to what
three.js's `MeshStandardMaterial` does: linear colour with a tone curve, a GGX highlight driven by
roughness, a prefiltered environment map, and material data per texel. Each stage ships behind a
`RENDER_TUNE` switch whose 0 is today's picture.

## Where it stands (2026-10-03)

- **21 material families**, one row each in `MAT_BRDF` in
  [windshield.js](../../client/game/js/panels/windshield.js), beside the painters: a Phong exponent,
  metalness, reflectivity, relief strength, sheen and specular strength. The material block in
  [gl/context.js](../../client/game/js/panels/gl/context.js) does Schlick Fresnel with a metal's own
  F0, reflects a two-colour gradient plus the 64-bin skyline strip
  ([gl/skyline.js](../../client/game/js/panels/gl/skyline.js)), and recovers relief from the albedo's
  luminance gradient. The history is in [glass-notes.md](../reference/glass-notes.md#materials).
- **No colour management.** Every CPU colour is divided by 255, no texture uses an sRGB format, the
  WebGL canvas sets no colour space, and the lighting maths runs on display values. The float target
  and an ACES curve exist in [gl/hdr.js](../../client/game/js/panels/gl/hdr.js), but `glTonemap` is
  0, which is a clamp.
- **One family per palette key.** 89 keys land in the `window grid` row, including all 66
  `FACADE_MAT` facades, so a brick tenement and a stone bank respond to light identically, and their
  window panes respond like the wall around them.
- **The reflection never sees weather.** `uEnvUp` is the dimmed horizon colour (set in
  [gl/install.js](../../client/game/js/panels/gl/install.js)), and overcast and cloud are 2-D layers
  painted over the sky.
- **Lit windows at night are guessed.** The night dim spares any pixel whose lit colour is bright
  (`smoothstep(0.28, 0.55, luminance)` beside `uNightDim`), so a bright reflection escapes the dim and
  a lit window in shadow falls under it.

## Out of scope

- See-through glass. Every window is an opaque skin over a solid building, so there's nothing behind
  it to refract. The `frost` row already covers etched glass.
- Iridescence, anisotropy, and clearcoat on buildings. Vehicles have their own clear-coat sheen in
  [gl/solids.js](../../client/game/js/panels/gl/solids.js).
- Inverse-square falloff. Lights fall off linearly on purpose; the reasons are in the shader.
- GLASS 1, the 2-D renderer. It reads the same painter canvases and doesn't change.

## Order

| Stage | What | Size |
|---|---|---|
| 0 | Guards and measurement | S |
| 1 | The window mask and facade families | M |
| 2 | Linear colour and the tone curve | L |
| 3 | GGX highlight and prefiltered environment | M |
| 4 | Height and roughness in the painters | L |

S is about a session, M two or three, L open-ended and mostly re-tuning by eye.

The window mask goes first because it's exact and cheap, it's the most visible single change, it
re-grades nothing, and it replaces the luminance-threshold night dim, which wouldn't survive linear
colour anyway. Linear colour goes before the highlight and the environment because anything tuned on
display values would have to be tuned again.

## Stage 0: guards and measurement (built 2026-10-03)

Nothing changes on screen. The benches are described in the
[Modelshop README](../../tools/modelshop/README.md#before-and-after-a-code-change-__glrefshots-__glatlashash).

- **Atlas hash.** `__glAtlasHash()` ([tools/modelshop/atlashash.js](../../tools/modelshop/atlashash.js))
  hashes all 1,308 surfaces the atlas takes, through `bakedSurfaces` in windshield.js, which pins
  `texRes` (outside a frame it answers whichever seat painted last). Stable to the bit between runs.
- **GPU time.** `__glWhere()` ([tools/modelshop/districtcost.js](../../tools/modelshop/districtcost.js))
  wraps each measured paint in a timer query and reports `gpu` and `gpuP90`. First reading at
  Halcyon, on a busy machine: 6.8 ms from the cab, 10.6 ms from the air. The murmuration now stands
  aside while another timer query is open; before, a frame timer broke both its timing and the
  bench's.
- **Reference shots.** `__glRefShots()` ([tools/modelshop/refshots.js](../../tools/modelshop/refshots.js))
  saves sixteen frames (Halcyon and Marrow Street, cab and air, noon, dusk, night, storm) and diffs a
  later run against them. Noise floor across a reload: 0.01% of pixels or less on every shot.
  `__glMaterials()` gained a dusk cab seat and a storm air seat.
- **The float-unsupported path is fixed.** The emissive gains now follow `hdrLive()` (whether the
  float buffer actually bound) instead of `opts.hdr` (whether it was asked for). With the float
  extension blocked, a night frame at `glHdr` 1 and at 0 now differ on 0% of pixels.
- **Classification.** `wallTexSmoke` (in `shapes:smoke`) already failed a palette filed in two
  families, but its list was missing `CHROME_WALL` and `MARBLE_WALL`; both are in it now. No key is
  filed twice today.

## Stage 1: the window mask and facade families (`glMatPage`)

- **A second atlas page**, built beside the albedo from the same keys at the same canvas sizes.
  [gl/atlas.js](../../client/game/js/panels/gl/atlas.js) packs deterministically by key and size, so
  the rects come out identical and no vertex attribute is needed. It binds on texture unit 4; 0 to 3
  are the atlas, the sun shadow, SSAO and the skyline strip.
- **Channels:** R is glass coverage, G is emissive coverage, B is height (stage 4), A is 255. Data
  never goes in alpha: canvas pixels are stored premultiplied, so low-alpha texels lose precision on
  upload, and alpha already cuts the lattice holes.
- **Painting it.** The default facade's panes are the last pass in `wallTex`: a fixed grid, a pure
  `frac` hash deciding lit or dark, one `fillRect` per pane. Factor the grid and the hash into one
  function both pages call, so the mask can't disagree with the picture. `SHOP_GLASS` tiles are
  coverage 1 throughout.
- **The wall between the panes gets its own family.** `FACADE_MAT` already names each facade's wall
  painter, so `wallMaterialOf` maps painter to family (`matBrick` to brick, `matStone` to stone, and
  so on for concrete, tile, stucco and panel). The shader blends rows,
  `M = mix(uMat[vMat], uMat[GLASS], glassCov)`, and scales relief by `1 - glassCov`. That removes the
  reason the `window grid` bump is held at 0.18, which is that lit panes read as raised.
- **Night dim from the mask:** `base *= mix(uNightDim, 1.0, emissive)` replaces the luminance guess.
  Emissive changes with night and power state, so the page uses the albedo's keys (`win` variants,
  the dusk blend, `texEpoch`) and rebuilds when the albedo does, never on a trigger of its own.
- **Cost:** atlas memory doubles, to about 8 MB at texRes 1 and 32 MB at 2 and 3. Off on
  `PHONE_TIER`.
- **Known gap:** from texRes 2 up (the cab), the detail tier draws mullions and blinds inside each
  pane rect, so the mask claims a little too much glass. Accept it, and paint the mullions into the
  mask later if it shows.
- **Then** the other window painters: `GLASS_WALL`, `ty_asc_shaft`, the Meridian's `DECO` tile and
  the pump's digits.

## Stage 2: linear colour (`glLinear`)

This only applies while the float target is live. Phones (`PHONE_TIER` forces `glHdr` to 0) and
devices without `EXT_color_buffer_float` stay on today's path.

1. **A linear buffer with the same picture.** A shared GLSL chunk (a new gl/colour.js with
   `toLinear` and `toSrgb`, using the exact piecewise curve) is used twice. The hdr.js composite
   encodes at the very end, after the tone curve. Every layer that writes the float target decodes
   its own output as its last line (un-premultiply, decode, re-premultiply). What's left of the
   difference is that blending now happens in linear light, which dims additive neon halos and moves
   alpha edges. Measure that on its own before going on. The world and the cloud deck composite
   separately each frame, and both encode the same way.
2. **The mass shader takes linear inputs.** Upload the atlas and the material page as `SRGB8_ALPHA8`
   so the hardware decodes and filters them. Decode `aColor` in `uploadGroups`, after the day/night
   lerp so the dusk blend doesn't move. Decode the uniform colours in install.js's `u()`. Convert the
   shader's literals that were tuned as display values: the snow albedo, `WET_DARKEN`, the overlay
   alphas. Then drop this layer's output decode. This step is the real look change: falloff,
   overlays, AO and fog all shift.
3. **The other layers**, in order of screen area: floor and ground, water, solids with actors and
   cloth, decals with sprites and strokes, clouds, billboards. One commit and one re-tune each.
4. **The tone curve.** Try Khronos PBR Neutral first (three.js's `NeutralToneMapping`), because it
   keeps authored palette hues where ACES shifts them. Keep ACES as the alternative, and set the
   exposure.

What stays in display space: the sky pass (it writes the canvas directly), `drawInteriorAlone`, every
8-bit intermediate (the mirror, the cloud-volume march, FXAA's target, the skyline strip, the floor
lookup tables), and the 2-D grades after the blit (`nightLift`, the weather fills). The rule is to
decode at output only when writing the float target.

The cost is the re-tune. The light palettes (`vlKeyDay` and the rest), the overlays, the AO
strengths and the fog were all tuned by eye against display maths. Re-tune at noon, dusk, night and
in a storm, in Coldwater, Halcyon Fields (`hfTint`), Old Coldwater and the Scarletwastes.

## Stage 3: GGX highlight and prefiltered environment (`glGGX`, `glEnvCube`)

**The highlight.**

- Replace `pow(dot(n, H), gloss)` with a GGX distribution, a Smith visibility term and Schlick
  Fresnel with `F0 = mix(0.04, albedo, metal)`; diffuse scales by `(1 - F)(1 - metal)`. The key light
  only. Point lights keep their wrapped diffuse and wet lobe.
- Start from the table as it is: the shader derives roughness as `sqrt(2 / (gloss + 2))`, so the
  first frame compares directly with today's. Add a roughness column when tuning starts, and raise
  `needs.fragUniformVectors` in install.js for the extra vec4 per family.
- The flat-box rule still applies. A highlight on a planar face has one normal, so masonry keeps its
  small specular strength. Per-texel relief and roughness (stage 4) are what make a highlight travel
  across a wall.
- Sheen stays as it is.

**The environment.**

- **One sky definition.** Lift the part of [gl/sky.js](../../client/game/js/panels/gl/sky.js)'s
  fragment shader that depends only on direction (gradient, sun glow, airglow, galaxy) into a shared
  `skyColor(dir)` chunk, and use it for both the sky pass and the cube. The moon is placed in screen
  pixels and the stars are sized per pixel, so both stay out.
- **Weather goes in.** Add an overcast term from the weather cells the cloud deck already reads.
  Without it, a storm would reflect a clear sky with a sun glow in it.
- **The cube.** 32 or 64 texels a face, RGBA16F, rebuilt when a sky key changes (quantised hour,
  weather, moon), never per frame. Blur each mip level with hdr.js's downsample and blur programs, a
  cheap stand-in for GGX prefiltering that's enough for a smooth sky. Sample with
  `textureLod(cube, R, roughness * maxMip)`. An explicit level is safe there because the material
  block sits inside a branch on a uniform.
- **The skyline strip stays**, mixed over the cube as it's mixed over the gradient today, with its
  edge softened by roughness.
- **Expect a look change in the glass.** Today the reflection's "up" is the horizon colour. A real
  sky puts zenith blue in it.
- **Later:** point vehicles (`envAt`, `envSoft`, `envRich` in gl/solids.js) and street actors
  (`envAt` in gl/actors.js) at the same cube, so everything reflects one sky. Diffuse light from the
  cube's lowest level is a separate switch (`glEnvDiffuse`), off by default. Water keeps its own sky
  strip, which has the clouds in it.

## Stage 4: height and roughness in the painters

- The painters take `(g, W, H, w, tr, amp)` and are deterministic (`frac`, never `Math.random`), but
  they carry about 240 hard-coded colours: baked joint shadows and edge highlights, rust, lichen,
  verdigris, marble veins. No single switch can turn them into material data, because each draw call
  needs a meaning (a recess, a stain, a pane), so the work goes painter by painter.
- Each converted painter paints a height channel from its own joints, laps and boards. The precedent
  is `texHeight` in gl/solids.js, which gives each cabin material a procedural height field. The
  relief then reads height instead of luminance, at the same three texture taps, so joints stop
  moving with the time of day and rust stops reading as a bump.
- Add roughness where a substance differs from its wall: rust and lichen rougher, polished stone and
  tile smoother.
- Order by how many keys a painter covers: `matBrick`, `matStone`, `matConcrete` and `matStucco`
  first (the facade painters), then `matPlate`, `matLattice` and the rest, then the three roof paths
  in `roofTex`.

## Checks, per stage

- At 0, every switch draws today's picture. `npm run perf:exact` proves the draw records match; a
  pixel diff at the reference seats covers what a record can't show.
- `gl:opts`: every new option is in install.js's allowlist, or it's silently dropped.
- `gl:glsl`: every new uniform and sampler is declared.
- `gl:mat`: the roughness column is in range, no `FACADE_MAT` key is left on the default row, and the
  painter and family orders agree.
- `gl:hdr`: the encode and the chosen curve are monotonic and keep black black.
- A new pure-JS check that `toLinear` and `toSrgb` round-trip within 1/255, with the GLSL
  coefficients matched by text as `gl:hdr` does.
- In the Modelshop: `__glMaterials()` readings, `__glAtlasHash()` unchanged wherever the albedo should
  be, the GPU timer before and after at the Halcyon cockpit and cab, and screenshots at the four
  times of day.
- `shapes:smoke` and `client:smoke`. The GLSL sits in template literals, so comments inside it quote
  with single quotes, never backticks.
- Before any default changes, measure on an integrated GPU and a phone. Every number so far comes
  from one machine with an RTX 2070 SUPER.

## Also found

These came up in the survey for this plan and aren't part of it:

- `PT_FRAG` in gl/seabed.js blends straight alpha into the premultiplied target.
- Stale comments: gl/context.js says twice that `glShadow` defaults to 0 (it's 0.55), a `RENDER_TUNE`
  comment in windshield.js says the relief takes two texture taps (it takes three), and
  [glass-notes.md](../reference/glass-notes.md#hardware-coverage) gives old attribute and varying
  counts (the pass now needs 11 attributes and 22 varying components).
