# GLASS materials

**Status: Stages 0 and 1 built (`glMatPage`); stage 2 steps 1 and 2 built (`glLinear`), steps 3 and 4 to do; stage 3 built (`glEnvCube`, `glGGX`); stage 4 built (`glSurfPage`). Every switch is off by default.** This is the plan for bringing GLASS 2's surface shading up to what
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

**Built 2026-10-03, for all six skins with windows.** As built:

- `wallMatMixed` picks a page painter with `wallMatKind` (the default facade, the shopfront, curtain
  glass, the Spire, the Meridian, the pump) and `paintWallMat` runs it from `MAT_PAGE_PAINTERS`. 102
  palettes of 437 have a page. Each skin's geometry and lit test live in one helper both painters
  call: `paneGrid`/`panes`/`paneLit`, `shopLayout`, `curtainGrid`/`curtainHash`, `spireLayout`/
  `spireLit`, `decoLayout`/`decoBayWindows`/`decoLit`, and `PUMP`/`pumpRect`. `buildAtlas` takes a
  tile's `mat` and returns `matCanvas`; `setMatPage` uploads it to unit 4, which is bound on every
  draw (to the page or to nothing) so it can never hold a render target.
- The channels are r glass, g lit, and b = 1 + the family of the tile's non-glass texels, so b also
  says whether the page speaks for a texel. ⚠ b is constant across a tile: the page is minified
  with LINEAR filtering, and a blend of two family indices is a third, unrelated family. So a
  curtain wall is b = metal with r marking the panes, and the shader mixes the metal and glass rows
  by r. The frames are metal for the shopfront and curtain glass, chrome for the Spire, the
  Meridian's limestone (`deco`) and the pump's enamel (`pump`). b takes the place of the height
  channel planned below; stage 4 will need another home for height.
- Checked for the five extra skins: all 5,244 albedo surfaces byte-identical before and after the
  painters were refactored onto the shared helpers. On every one of the 102 pages the texels marked
  lit are far brighter than the unlit glass in the night albedo (the Meridian is 150 against 14).
  With every skin on, Halcyon from a cab moves about 10% of the frame, from the curtain glass.
  A saved `__glRefShots` set is only good while the baked world under it holds still; other
  sessions edit the world, so compare against a set taken in the same sitting.
- Checked: all 5,244 baked surfaces (437 keys, every grid state, `texRes` 1 and 2) are byte-identical
  to the commit before, so the shared pane code changed nothing. With the switch at 0, the sixteen
  reference shots match the commit before inside the noise floor (at most 0.014% of pixels). On, no
  GL errors, and the change sits on the panes: 0.02% to 1.2% of a reference frame, up to 3% from a
  cab facing a row of facades. GPU time on and off is inside the run-to-run spread.
- On ordinary streets the effect is small: a pane's new glass row reflects the same two-colour sky
  everything else does. Stage 3 is what makes the glass read. `wallTexSmoke` now also fails a
  `FACADE_MAT` painter with no family.

As planned:

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

**Steps 1 and 2 built 2026-10-03.** `RENDER_TUNE.glLinear` is 0 (as shipped), 1 (step 1) or 2
(step 2). As built:

- [gl/colour.js](../../client/game/js/panels/gl/colour.js) holds the curve both ways (GLSL and JS),
  `LIN.out` (1 only while the float target is bound), and `linearOut(src, out)`, which renames a
  fragment shader's `main` and calls it from a new one that decodes the output. Every return and
  discard path goes through the one conversion. 17 shaders in 16 files are wrapped; each sends the
  flag after `useProgram` through `applyLinOut`, which only writes when the value changes.
  `beginTarget` sets the flag, the mirror pass and the room drawn alone force it to 0, and the HDR
  composite encodes back to sRGB after the curve.
- Step 2 covers the city's own shader only: the albedo, vertex colour, snow, skyline strip and the
  uniform colours are decoded, and its output is no longer decoded. The relief taps and the night
  dim's brightness guess stay on display values.
- **The display-tuned factors are converted (2026-10-04), so level 2 keeps A's contrast.** Every
  darkening multiplier goes through `lf(k)`, which is k^2.2 at level 2: wet darkening, sun-shadow
  darkening, the bevel, the three occlusion terms (and the occlusion that scales the reflection,
  highlight and sheen), the metal's diffuse drop and the night dim. The mixes toward a colour have
  no linear twin, so at level 2 they run on display values and the result is decoded: the two
  overlays, the lamp lift (whose weight reads the light colours back as display values) and the
  fog. The bloom and the composite run on display values at any linear level: the bright-pass
  encodes before its threshold, and the composite encodes the scene before the bloom and curve.
  What stays linear is light added to light: lamp light on walls, highlights, reflection, sheen,
  light shafts and the blends between layers.
- Measured on the reference shots: at 0, the cab shots match the earlier set (0 to 0.5%; the air
  shots drift with the shared world). Level 1 against 0 moves 2 to 13% of a frame by 4 to 12
  levels, mostly the lamp glows, which bloom harder because an emitter over 1 is much brighter in
  linear light. Before the factors were converted, level 2 against 1 moved about a quarter of a
  cab frame and Marrow Street's mean brightness went from 65.7 to 73.2 at noon.
- After the conversion, against the shipped city with the material page also on (the seven views
  of the A/B page): mean brightness within about one level everywhere (Marrow Street at noon 56.8
  against 57.9, Halcyon 59.2 against 58.9, the nights within 0.3), and 6 to 23% of a frame
  changes. What changes is the glass and frames (the material page) and the lamp and sign halos.
  A halo is added on top of whatever is behind it, and in linear light the same addition lifts a
  dark pixel more than a bright one, so the halo's edge comes out lighter. No per-layer decode can
  match that, because a shader can't see what is behind it. Matching it would take a separate
  buffer for the additive layers, summed in display values at the composite. **Decided
  2026-10-04: the halos stay as linear light blends them.** No separate buffer.
- Left: the other layers (step 3), the tone curve (step 4), and any re-tune away from the shipped
  look.

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

**Built 2026-10-04, both behind switches that default to 0.** As built:

- [gl/sky.js](../../client/game/js/panels/gl/sky.js) exports `SKY_DIR_GLSL`: the hour's gradient,
  the sun's glow, the airglow and the galaxy band as `skyDirColor(dir, sunLobe, band)`. The sky pass
  calls it and adds the stars itself; the reference shots match the old sky within the noise floor.
  `sunLobe` is the glow right round the sun: tight in the sky (`SUN_LOBE_SKY`), wide in the cube
  (`SUN_LOBE_CUBE`), which is too coarse for the tight one.
- [gl/envcube.js](../../client/game/js/panels/gl/envcube.js) renders that function into a 32-texel
  RGBA8 cube, with the overcast ceiling over the dome (the 2-D wash's own colour; the sun's glow
  scaled by 1 - overcast) and the ground colour below the horizon, then `generateMipmap`. It is
  rebuilt only when its inputs change, rounded to what can be seen. windshield.js gathers the
  inputs once a frame as `SKY_ENV` after the overcast ceiling is known, and the world pass hands
  them to the city's draw. Bound on unit 5, to the cube or to null, on every draw.
- The city's shader reads roughness from the table as alpha = sqrt(2 / (gloss + 2)), samples the
  cube along the reflected ray at level alpha x 5 (so glass and chrome read the sharp top level and
  render a soft one), decodes it at linear level 2, and leaves the skyline strip mixed over it as
  before. The GGX lobe keeps the old peak (D / D(peak)) and adds Smith shadowing, the light's
  cosine and a Schlick gain capped at 4.
- Measured on Halcyon at noon: the cube moves 3.1% of the frame and GGX 2.2%, against 0.01% noise.
  Against stage 2 (the C and B frames of the A/B page) stage 3 moves 0.6 to 4.6% of a frame, mostly
  darker: the upper floors of glass towers now reflect the zenith rather than the old pale horizon
  colour, and low windows catch the bright horizon. No GL errors; GPU time inside the run-to-run
  spread on a busy machine. With both at 0 the reference shots match within the noise floor.
- Not done: vehicles and street actors on the same cube, diffuse light from the cube's lowest level
  (`glEnvDiffuse`), and a roughness column in the table.

**As planned:**

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

**Built 2026-10-04, behind `glSurfPage` (off by default).** Brick, stone, concrete and stucco went
first; the rest followed the same day. As built:

- Height got a page of its own, the surface page (unit 6): r height (0.5 the wall's face), g a
  roughness scale (0.5 the family's own; each 0.5 halves or doubles it), b = 255 where it speaks.
  The material page had no channel to spare, since its b must stay constant across a tile and
  alpha can't carry data through a premultiplied canvas. Height doesn't change with the hour or
  the grid, so `wallSurf` paints a palette once per resolution and never at dusk. Magnified LINEAR,
  unlike the other two pages, because NEAREST turned every joint into a one-texel cliff.
- Every painter's geometry moved into shared generators: the thirteen material painters' above
  `matGrain` (`brickUnits`, `plateBlooms`, `tileCrack`, `grainDabs` and the rest), the ten skins
  `wallTex` paints inline and the three roof decks above `wallTex` (`timberGrain`, `shakeCourses`,
  `feltBallast`, the extended `PUMP` table and the rest). Each `surfX` twin paints the same units
  as height. The albedo came out byte-identical after every move: 2,622 surfaces, every grid state,
  at `texRes` 1 and 2, roofs included.
- `surfOf` picks the twin with wallTex's own tests in its own order, and the bare-material branch
  is one function both call (`bareMat`). Facades take their `FACADE_MAT` painter's twin at
  `FACADE_AMP` with the panes flat. 433 of 437 walls have a page; the four without are speckled
  facades with no `FACADE_MAT` entry. `roofSurf` gives every roof one, a page per kind of deck
  (felt, standing seam, shakes) per resolution, since none reads the palette for more than colour.
  `wallTexSmoke` bakes every page and fails a surface with no twin.
- A stain is roughness, not height. `surfRougher` adds to g alone (`'lighter'`, so r and b gain
  nothing), and lichen, rust (blooms, the runs under the laps, the ring round each rivet),
  verdigris, moss and copper patina go down that way, so the joints under them keep their depth.
  The smooth marks: frost where condensation cleared it, ponds on a felt roof (standing water, the
  smoothest thing up there), copper crowns rubbed back to the metal, bitumen, glaze.
- Height follows the thing, not the paint. Timber's dark grain stands proud, because weather wears
  the earlywood back and leaves the latewood. Plate's pitting is height, because on steel the pits
  are the surface; the other painters' grain isn't, so pinholes stop bumping. The bronze sheen and
  the structural column's light across its section are painted light, so those faces are flat, and
  so are marble's veins (under the polish) and chrome's horizon (a reflection).
- The relief reads `height * glHeightGain` instead of brightness where the page speaks, with the
  same three taps; the roughness scale multiplies the alpha the cube level and the GGX lobe read.
  The gain is 0.33, set on paper: a brick face sits about 0.15 brighter than its mortar in a typical
  palette, and the height step is 0.5. A measurement on concrete agreed in kind: the height relief
  covers fewer pixels than brightness did, because pinholes and streaks no longer bump.
- Measured: with the page off the reference shots match `pre-s3` within the noise floor (0.01% at
  most). With four painters it moved 0 to 1.4% of a frame against stage 3; with every surface, 0.3
  to 9.4% (Marrow Street from a cab at noon the most, then Halcyon from a cab at 6.3%). In Halcyon
  the change is the curtain walls' frames: the brightness relief read each mullion's painted
  gasket-and-return step as a slope, so the tilted texels reflected the street as brown glints
  along the grid. On the page the frames are flat metal and the glints are gone.

As planned:

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
