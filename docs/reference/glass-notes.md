# GLASS renderer and seat notes

Engineering notes for the GLASS renderer (`client/game/js/panels/windshield.js` and `client/game/js/panels/gl/`), the free camera and the seat layouts. Moved out of CLAUDE.md on 2026-09-27. Each section says what the rule is, why it exists and which gate checks it. Numbers are from one machine with a discrete NVIDIA card unless a section says otherwise. Where a section mentions the two-lists rule: a new gate goes in both the `pretest:regress` chain and `npm run shapes:smoke` (see CLAUDE.md).

## Contents

- [Big screen and seat layout](#big-screen-and-seat-layout)
- [Free camera standing mode](#free-camera-standing-mode)
- [Standing camera (`freecam.js` `stand` mode)](#standing-camera-freecamjs-stand-mode)
- [Vantages (`plugins/freelook`, `flags.telescope`)](#vantages-pluginsfreelook-flagstelescope)
- [Echelon superstructure (`YACHT_TIERS`)](#echelon-superstructure-yacht_tiers)
- [GLASS 2 as the default renderer (`RENDER_TUNE.gl`)](#glass-2-as-the-default-renderer-render_tunegl)
- [See-through fixes: putting 2-D surfaces on the depth buffer](#see-through-fixes-putting-2-d-surfaces-on-the-depth-buffer)
- [The far dissolve, over the ground (`RENDER_TUNE.glHazeSplit`)](#the-far-dissolve-over-the-ground-render_tuneglhazesplit)
- [Projection matrix units](#projection-matrix-units)
- [Which tiles belong to which renderer](#which-tiles-belong-to-which-renderer)
- [The skyline past the window (`noteSkyline`)](#the-skyline-past-the-window-noteskyline)
- [Model quality board (`npm run models:quality`)](#model-quality-board-npm-run-modelsquality)
- [Ground shader (`RENDER_TUNE.glFloor`)](#ground-shader-render_tuneglfloor)
- [Clip plane fitting (`RENDER_TUNE.nearFit`)](#clip-plane-fitting-render_tunenearfit)
- [Option allowlist (`npm run gl:opts`)](#option-allowlist-npm-run-glopts)
- [Vertex streaming (gl/stream.js(../../client/game/js/panels/gl/stream.js))](#vertex-streaming-glstreamjsclientgamejspanelsglstreamjs)
- [Ground buffer caching (not done)](#ground-buffer-caching-not-done)
- [Fidelity readings](#fidelity-readings)
- [Facade glazing bands (`RENDER_TUNE.glBand`)](#facade-glazing-bands-render_tuneglband)
- [World text on the depth buffer (`RENDER_TUNE.glSign`)](#world-text-on-the-depth-buffer-render_tuneglsign)
- [Sort bias versus depth offset (`DECO_PULL`, `BLADE_PROUD`)](#sort-bias-versus-depth-offset-deco_pull-blade_proud)
- [Sign culling (`cull` on a decal)](#sign-culling-cull-on-a-decal)
- [Sign lettering range (`RENDER_TUNE.signFar`)](#sign-lettering-range-render_tunesignfar)
- [Sign occlusion probe removed on GL](#sign-occlusion-probe-removed-on-gl)
- [`__glLeak` can't see the detail kit](#__glleak-cant-see-the-detail-kit)
- [Sign typefaces (`signFontOf`)](#sign-typefaces-signfontof)
- [Declining kit sections (`KIT_DECLINE`)](#declining-kit-sections-kit_decline)
- [What's left on the canvas](#whats-left-on-the-canvas)
- [Measuring the frame (`__glFrame()`)](#measuring-the-frame-__glframe)
- [Hardware coverage](#hardware-coverage)
- [A pass that didn't draw](#a-pass-that-didnt-draw)
- [Phones (2026-09-28)](#phones-2026-09-28)
- [Releasing GL scenes (2026-09-17)](#releasing-gl-scenes-2026-09-17)
- [Fidelity measurement (`__glFidelity()`)](#fidelity-measurement-__glfidelity)
- [Archetypes in the occluder field](#archetypes-in-the-occluder-field)
- [Night lights past `lodNear`](#night-lights-past-lodnear)
- [Adornments on the depth buffer (`RENDER_TUNE.glDeco`)](#adornments-on-the-depth-buffer-render_tunegldeco)
- [Lights as sprites](#lights-as-sprites)
- [Pixel sizes are device pixels (`npm run gl:dprsize`)](#pixel-sizes-are-device-pixels-npm-run-gldprsize)
- [Road fading](#road-fading)
- [Building power outages](#building-power-outages)
- [Point lights on walls](#point-lights-on-walls)
- [Materials](#materials)
- [Sky beam](#sky-beam)
- [Trade words on signs](#trade-words-on-signs)
- [Voltage and Aurelia rebuild (2026-09-20)](#voltage-and-aurelia-rebuild-2026-09-20)
- [Snow on the ground](#snow-on-the-ground)
- [Trodden ground and ground grain (`RENDER_TUNE.glWear`, `glGrain`)](#trodden-ground-and-ground-grain-render_tuneglwear-glgrain)
- [Plinth and crown bands](#plinth-and-crown-bands)
- [Sign stand-off](#sign-stand-off)
- [Clear wall band for a name](#clear-wall-band-for-a-name)
- [Sign shape and camera](#sign-shape-and-camera)
- [Graffiti hands](#graffiti-hands)
- [Halcyon Fields tint (`RENDER_TUNE.hfTint`)](#halcyon-fields-tint-render_tunehftint)
- [Lit drums (`RENDER_TUNE.glDrumLit`, 2026-09-27)](#lit-drums-render_tunegldrumlit-2026-09-27)
- [Pilaster ranks (removed)](#pilaster-ranks-removed)
- [Cloud deck on the depth buffer (`RENDER_TUNE.glClouds`)](#cloud-deck-on-the-depth-buffer-render_tuneglclouds)
- [Nothing in the cloud deck is cut (2026-10-02)](#nothing-in-the-cloud-deck-is-cut-2026-10-02)
- [Flying things write depth (`RENDER_TUNE.glAirDepth`)](#flying-things-write-depth-render_tuneglairdepth)
- [Baked billboards are for landmarks](#baked-billboards-are-for-landmarks)
- [Depot shed as geometry (`RENDER_TUNE.glBay`)](#depot-shed-as-geometry-render_tuneglbay)
- [Signal masts on the depth buffer](#signal-masts-on-the-depth-buffer)
- [Echelon fittings on the depth buffer](#echelon-fittings-on-the-depth-buffer)
- [Ground-pass dressing (`emitGroundLate`)](#ground-pass-dressing-emitgroundlate)
- [Windsocks](#windsocks)
- [Helipads](#helipads)
- [Corner light-runners on hand-written towers](#corner-light-runners-on-hand-written-towers)
- [Airfield gate](#airfield-gate)
- [Benches pin the adaptive dials](#benches-pin-the-adaptive-dials)
- [The original GL spike](#the-original-gl-spike)
- [Moving parts (`RENDER_TUNE.motion`)](#moving-parts-render_tunemotion)
- [Moving-part shading (`RENDER_TUNE.motionShade`)](#moving-part-shading-render_tunemotionshade)
- [Lattice palettes for crane masts](#lattice-palettes-for-crane-masts)
- [Cut lattice openings (`RENDER_TUNE.latticeCut`)](#cut-lattice-openings-render_tunelatticecut)
- [Rear and flank piers (section 1e of `derivedKit`)](#rear-and-flank-piers-section-1e-of-derivedkit)
- [Camera pitch (`camPitch`)](#camera-pitch-campitch)
- [The sea surface](#the-sea-surface)
- [Swell versus chop](#swell-versus-chop)
- [Why the swell is a mesh](#why-the-swell-is-a-mesh)
- [Lighting](#lighting)
- [Sea state from the wind](#sea-state-from-the-wind)
- [The ship's ride](#the-ships-ride)
- [The sea clock](#the-sea-clock)
- [Shader traps](#shader-traps)
- [Measurement](#measurement)
- [Crest translucency](#crest-translucency)
- [Wake foam trail](#wake-foam-trail)
- [Spectral spread](#spectral-spread)
- [Sea benches](#sea-benches)
- [Harbour shelter](#harbour-shelter)
- [Hull inertia and roll response](#hull-inertia-and-roll-response)
- [Shoaling refraction](#shoaling-refraction)
- [Surf and breaking](#surf-and-breaking)
- [Far swell](#far-swell)
- [Displaced chop near the eye](#displaced-chop-near-the-eye)
- [Foam keyed on steepness (not built)](#foam-keyed-on-steepness-not-built)
- [Hydro launches](#hydro-launches)
- [Neon glitter on the harbour](#neon-glitter-on-the-harbour)
- [Underwater camera](#underwater-camera)
- [Seabed view](#seabed-view)
- [Wet glass after surfacing](#wet-glass-after-surfacing)
- [Bench clock for temporal events](#bench-clock-for-temporal-events)
- [Street lamp pools](#street-lamp-pools)
- [Glow radius floor and lamp halos](#glow-radius-floor-and-lamp-halos)
- [Ground shader lights on dry nights](#ground-shader-lights-on-dry-nights)
- [Measuring the pools](#measuring-the-pools)
- [Lightning channel](#lightning-channel)
- [Lightning draw order](#lightning-draw-order)
- [Lightning scene light](#lightning-scene-light)
- [Storm sea floor](#storm-sea-floor)
- [Weather-aware wind](#weather-aware-wind)
- [Forward-leaning waves](#forward-leaning-waves)
- [Foam on the crest front](#foam-on-the-crest-front)
- [Modelshop serves a stale glbench.js](#modelshop-serves-a-stale-glbenchjs)
- [Crest spray](#crest-spray)
- [More wave components (reverted)](#more-wave-components-reverted)
- [Hydro seat](#hydro-seat)
- [Hydro HUD wheel](#hydro-hud-wheel)
- [Torn foam](#torn-foam)
- [Two foam populations](#two-foam-populations)
- [Foam quantiler accuracy](#foam-quantiler-accuracy)
- [Far-water whitecaps](#far-water-whitecaps)
- [Whitecap size](#whitecap-size)
- [Bigger storm seas (101 m swell)](#bigger-storm-seas-101-m-swell)
- [Sea headroom at the 101 m wavelength](#sea-headroom-at-the-101-m-wavelength)
- [Graded sea patch (state 8)](#graded-sea-patch-state-8)
- [Decal texture cache](#decal-texture-cache)
- [District cost bench](#district-cost-bench)
- [Truss web LOD](#truss-web-lod)
- [Cliff massifs](#cliff-massifs)

## Big screen and seat layout

`body.bigscreen` is the rung above each seat's ⛶ button: the whole window, with no header, sidebar, log, command box or seat readouts.

`bigscreen:smoke` ([scripts/client/bigscreen-smoke.mjs](../../scripts/client/bigscreen-smoke.mjs)) guards it. Each failure it catches is silent:

- A seat with no stripping rule just looks like the mode isn't working.
- A seat that doesn't call `exitBigScreen()` on its close path strands the player: the mode owns the page, so leaving the cab in big screen leaves a room with no sidebar, log or command box, and the key that exits is only bound while the mode is on.
- The seat list is derived from callers of `windshieldHTML(`, so a new seat fails the gate until handled. `OWNER` records where each seat's chrome lives (helm-view paints, helm-mode owns the buttons and close); each entry is a reason.
- The seat scan reads raw source. The comment blanker wipes template literals including their interpolations, and three of four seats build `${windshieldHTML(id, label)}` inside a template.
- It can't check whether CSS rules win. To verify layout, serve `client/` as the web root (modules resolve `/shared/…` absolutely), open each seat into `#area-content` with no server or login, and list every visible element that is neither inside a `.ws-wrap` nor an ancestor of one. The list should be empty (the cab keeps one: the clipped screen-reader record).

### Two axes

- ⊟ and ⛶ fold the column (log, then command box). `body.nosidebar` removes the 240px sidebar. They compose: a free-look pane goes 1007 → 1039 px wide at ⛶ and 1039 → 1280 px with the sidebar off.
- `nosidebar` is cleared when the seat closes, like big screen. The base UI has no sidebar switch, so a player left with it on would have no way back.
- Free look has ⊟/⛶ too. `#area-pane` is capped at `min(65%, --pane-cap)`, so free look needs the room as much as any seat.

### Gate rule for close paths

A rung (`X-fullscreen`, `X-hidepanel`) that a file turns on must be turned off by some close path in that file. The page-level classes (big screen, sidebar) must be cleared by every close. Asking each exported `close*` to clear every rung its file toggles is wrong for files with two seats: cockpit.js holds both the flight sim and the charter cabin.

## Free camera standing mode

`freecam.js` has a `stand` mode: feet down, an eye height passed in, and a leash. The mouse, rim push, lens, speed ladder, idle fade and key routing are unchanged.

- Standing, forward drops the pitch term: you look up and still walk level.
- All motion goes through one `place` function that overwrites z, so R/F and the vertical mouse buttons do nothing when standing, and new controls inherit that.
- The orbit is refused at the button as well as in `orbit()`; otherwise a middle-button drag would feed deltas to a refused orbit and the mouse would stop looking.
- The leash anchor follows a rebase.
- `scripts/shapes/freecam.mjs` gates this, with a flying camera as the control.

### `freeCam.setStand`

A button can toggle standing without reopening. `open({stand: true})` resets yaw, pitch, lens and speed, which loses the frame the player wanted to keep; `setStand` keeps them (measured: yaw 181 and pitch 0.228 survive, z drops 1.4 → 0.12, `STAND_EYE`).

- Set constraints before position. `place` reads `eye` and `leash`, so the other order spends a frame at the wrong height.
- The anchor is where you're standing now, not where the camera started.
- The leash is 0 for a person on foot. A vantage uses `STAND_LEASH` because it's a fixed place.
- `freeCam.standing` (feet down now) is not `st.stand` (opened as a vantage, which decides the label, recentre, detail tune and per-frame eye height). Don't read one for the other.
- A vantage gets no FPS button; it's a mounted instrument.
- The hint text follows the current mode, so a standing camera doesn't advertise orbit, roll or vertical controls.

## Standing camera (`freecam.js` `stand` mode)

`freecam.js` has a `stand` mode: the feet are on something, the eye height is passed in, and there's a leash. The mouse, rim push, lens, speed ladder, idle fade and key routing are unchanged; only three things about where the eye may be are different.

- Forward drops the pitch term. Flying, W follows the lens and looking up takes off; standing, you can look at the sky and still walk forward. That's all "FPS controls" means here.
- Up and down do nothing because every control moves through one `place` function, which overwrites z. R/F and the two mouse buttons cost a clamp, and any control added later gets the same rule.
- Trap: the orbit is refused at the button as well as in `orbit()`. The pointer binder reads `cam.orbiting` to decide whether a drag aims or swings, so a middle button that set it would send every delta to an orbit that refuses, and the mouse would stop looking while the button was held.
- Trap: the leash anchor moves with a rebase, or a re-centre drags the shot to the edge of a tether that's now somewhere else.

Gate: the standing block in `scripts/shapes/freecam.mjs`, with a flying camera doing the opposite as its control.

## Vantages (`plugins/freelook`, `flags.telescope`)

A vantage is the standing camera fixed in place. Furniture with `flags.telescope` is somewhere you stand: the `telescope` verb sends the same `freelook_open` the staff camera sends, plus a `stand` block. It lives in `plugins/freelook` because there's one camera-over-a-tile message on the wire: one viewer set, one 15 s sky push, one `freelook close`. A second plugin sending that message would be a second owner of a pane whose close reached only one of them.

- It isn't behind the staff gate. `freelook` is staff-only because it shows ground you haven't walked to; a telescope is a fitting in a room you're already in.
- A vantage names a mount instead of an eye height when it stands on something whose shape the server doesn't know. The Echelon's sun deck height comes from her model and its position from the swell, so `mount: 'yacht_scope'` is answered by `yachtScopeMount()`, the same function that places the drawn instrument. It's asked every frame so the shot rides the swell.
- Trap: use the same clock. `paintWindshield` and the rAF timestamp both run on `performance.now()`; a mount sampled from `Date.now()` puts the camera where the deck was at some other instant.
- `self` is cleared on the centre cell (`yachtHelmWindow`'s own line). That flag stops a cab being drawn inside its own building, which is wrong for a camera standing on something.
- `STAND_TUNE` raises `lodNear`, `decoFar`, `glowFar` and `shadowFar` for a vantage, because every LOD number is set for a moving camera and this seat can't move. It goes through the per-seat `tune` seam; `RENDER_TUNE` holds the player's own sliders and would follow them into the next cab.
- `texRes` is left out of `STAND_TUNE` even though it's tunable: at 2 every surface wants a 2048x4096 atlas page against WebGL2's guaranteed 2048 square, and `buildAtlas` answers a page it can't fit by dropping the whole city to flat palette colours.
- `detailNear` isn't in `VIEW_TUNABLE`, so it can't be raised this way, which is correct: its gate records 3 → 6 taking a dense night block from 21.0 ms to 24.3.

## Echelon superstructure (`YACHT_TIERS`)

Her deckhouse ran 0.085 to 0.163: three tiers totalling 0.078 of local height on a 2.08-long hull, a 27:1 superstructure where a 60 m four-deck yacht is nearer 5:1, while her interior holds a bridge, foyer, suite, broadcast studio, stern deck, helipad, landing and sun deck. `YACHT_TIERS` is the table now (a deck is 0.046 of local z, derived) and she tops out at 0.222, about 5.5:1.

- `YACHT_DECKZ` doesn't move. It's the helipad floor, and `yachtPadZ` and cockpit.js's deck-landing capture read it, so she grows upward from the pad and helicopters land where they always did.
- Each deck plate overhangs the house it carries. The old shape stepped back in plan and stacked roof straight onto floor, so the flanks merged into one dark wedge; an overhang gives a bright top, a dark fascia and a shadow at every level from any angle.
- `n·h` is constant over a plane, so a specular lobe on a flat face lights the whole face. With the sun high and the eye above her, every horizontal surface went to (175,182,192) at once: invisible at a fly-past, and the whole picture from a camera standing on her. `matte` keeps a tenth of it; flanks, transom, glass and domes are unchanged.
- Nothing on a deck may overlap anything else horizontally. The renderer sorts far to near and fills, so a sunken pool is painted over by the plate it's sunk into (the first jacuzzi was invisible from every angle). The spa and companionway are raised instead, the spa's surround four quads round a hole.
- `drawYacht`'s canvas near plane was 0.12 tiles, nearly a fifth of her beam, which hid the terrace under a vantage. It's 0.065 now; the floor is `cam.proj`'s own `Math.max(0.06, …)`. This is a canvas number only: the collecting pass returns before it, so GLASS 2 draws the deck correctly whatever it is and `yacht.mjs`'s camera-independence check is unaffected.
- The sun deck is drawn at every distance, since that gate forbids geometry that depends on the camera. Only the stroke work (planking, grab rail, close-spaced stanchions) is near-only; it's a fitting and is re-collected every frame anyway.

## GLASS 2 as the default renderer (`RENDER_TUNE.gl`)

GLASS 2 has been the default since 2026-09-09. `RENDER_TUNE.gl = 0` (the **GLASS 2 (WebGL)** slider, or `__wsTune.gl = 0`) puts the city back on the CPU. The evidence for the switch: the camera agrees with `cam.proj` to 5.7e-14 px across five device-pixel ratios (`gl:parity`, 3,931 projections); the mesh agrees with the shape every building collides as at all four facings (`gl:mesh`, 10,853 faces); a real Coldwater frame measured 18.3 ms average, 31 ms worst; and the ground-to-air crossfade, the Curtain and the signage all use the depth buffer instead of a probe.

It fails safe: no WebGL2, a lost context, a shader that won't compile, a texture page the device can't hold, a pass that returns nothing, and a pass that throws all hand the world back to 2-D and set the flag to 0. Coming back to a backgrounded tab tries GL again, twice at most (see [Phones](#phones-2026-09-28)). Every number comes from one machine with a discrete NVIDIA card, so falling back correctly says nothing about speed on an integrated GPU.

### How the pass is wired

With `gl = 1` the city's mass is drawn in WebGL2 and the model arms run with `MASS_OFF`, so lights, signs, adornments, the ground pass and the HUD paint on top as before. `MASS_OFF` isn't new: distance LOD has always used it to draw a far building's neon without its walls.

- At 0 there's no code path: no canvas, no context request, and `framecost` is unchanged to the call.
- windshield.js imports none of the GL code, because the cold open loads that file and must never touch a GPU, and the smoke suite loads it against a DOM stub with no WebGL. The pass is installed from outside (`installGL()` in cockpit.js, imported by main.js at boot). A throw inside it sets the flag to 0 and finishes the frame in 2-D.
- The GL canvas never joins the document. A canvas under the 2-D one is covered by the opaque sky and ground, and on top it would cover every light, so `drawWorldObjects` blits it where the mass used to be queued, using the current transform so bank and shudder come free.
- `MASS_OFF` set globally deleted every building type with no model of its own (`luxtower`), which has no GPU mesh to replace it.
- It's also a per-seat key (`VIEW_TUNABLE`), so a view can opt in with `tune: { gl: 1 }`.

Measured end to end: 5.7 → 2.4 ms on a truck's 33-tile window and 21.8 → 13.6 ms on an aircraft's 73-tile one, with one buffer rebuild over 48 steady frames. The speed depends on the buffer being built once. Three mistakes each rebuilt it every frame while drawing a correct picture: an order-sensitive key, a mesh built at the camera-relative position instead of the map-window tile, and a tile set taken from whatever survived the 2-D culls. Only `glLastFrame().builds` distinguishes them. A rebuild also has to be cheap, since the window recentres as you drive and the resolution dial resizes the canvas: it took 11.1 ms at an aircraft's window until vertex data was written into a `Float32Array` directly and each tile was passed as its shared face list plus an offset instead of a copy. It's 0 ms now.

### Adornment surfaces in the mesh

Every panel, band, louvre, sill, coping, jamb and soffit goes through `emitFlat`, which records into `MESH_SINK` and obeys `FLAT_OFF`. Trap: `FLAT_OFF` suppresses exactly what the mesh took. Gradient and stroke-only quads aren't in the mesh, and a blunter flag would delete them instead of moving them. Light (neon, glow, bloom, painted signage) stays on the 2-D canvas, which is why the arms still run.

- The mesh captures at `ADORN_NEAR`. That tier only exists because the 2-D renderer can't afford it at range; a depth-buffered mesh can, so recessed doorways, sills and mullions are always there: 1,191 → 2,133 faces at the same 0.13 ms, frame 5.1 → 2.0 ms.
- The capture offset follows the entrance. The arm runs displaced so its front faces the stub camera (sixty arms test `frontVis`), and the displacement was a fixed step along y: right for north-facing buildings, wrong for the other three, so a shop lost its whole near tier on three facings of four. The shape capture only runs at [0,1], so nothing reported it. `gl:mesh` now captures all four facings and requires identical face counts.

## See-through fixes: putting 2-D surfaces on the depth buffer

A painter's queue hides things by painting over them. With the mass on the GPU, it's composited before the 2-D pass, so nothing can paint over a 2-D adornment any more and every surface that relied on that draws through the city. `decoHidden` can't substitute: it answers whether a whole surface is covered, and a sign half behind a tower is the common case and the one it deliberately draws. The fix each time is to put the surface on the depth buffer, depth-tested and writing no depth of its own:

1. Lights (`gl/sprites.js`).
2. The Curtain (`gl/curtain.js`). It's a wall taller than the city whose gradient, scan bands, rain and crown are functions of position along and down it, so the port is exact.
3. Marquees (`gl/decals.js`): textured quads batched by texture, with the artwork still painted by the same 2-D code into a baked canvas, so there's one definition of what a sign looks like.

- Trap: a wall-mounted sign must stand proud of its wall. `marqueeBand` mounted at `half * 0.94`, six per cent inside the facade; the 2-D renderer survived by sorting it forward, but the depth test lets the wall win every pixel. Same reason `FACE_EPS` exists.
- Trap: a surface queued through `emitFace` is collected at flush, after the GL composite has run. The Curtain filled its sink inside the queued closure, never reached the GPU, and drew and reported nothing.

## The far dissolve, over the ground (`RENDER_TUNE.glHazeSplit`)

Buildings fade out over the last `HAZE_BAND` tiles of the draw distance. The mass is drawn first and writes depth, and the floor, the sea and the roads are drawn after it and test against that depth. So a block at 20% opacity in the band still hid the ground behind it, and the other 80% showed the bare canvas under the GL buffer: a dark green cut-out of every building at the edge of the draw distance, most visible from the air.

- The band is split off now. `draw` discards it (`uFadePass` 1), and `drawFade` draws only the band after the ground: a depth-only pass, then a blended colour pass, so only the nearest face of a fading block lays over the ground and its back walls don't show through.
- `drawFade` reuses the frame's env cube, sun map and SSAO texture rather than running those passes again. All three bind framebuffers of their own, which would unbind the target the floor and roads were just drawn into.
- The mirror doesn't split (nothing is drawn after it), and nor does a frame with no haze band.
- `glHazeSplit: 0` is the old single pass. `glLastFrame().hazeFade` is 0 when the second pass didn't run.

## Projection matrix units

`makeCam` works in CSS pixels; the GL canvas is a backing store in device pixels. `projMatrix`'s x row (`2·FL / cam.W`) happened to use camera terms only, but the y row (`2·depth / H`, `1 − 2·horizonY / H`) took the canvas height, scaling the vertical axis by 1/dpr and displacing the horizon. On a 459×467 pane at dpr 1.2 every building rose 38 px, base and roof by different amounts, so the city was lifted and squashed. The matrix is built in the camera's units now.

Trap: the error is exactly zero at dpr 1, which is every headless test canvas and every Modelshop scene; nine reproduction attempts came back clean. `gl:parity` now sweeps five ratios through a device-pixel viewport.

## Which tiles belong to which renderer

GL takes a tile on `massTile(c) && modelFor(c)`. The 2-D pass suppressed its walls on `GL_CELLS && m`, a second expression that didn't agree on tiles `massTile` rejects but `modelFor` answers (a statue, gate, sign, pylons, strip, bay, the yacht, a no-fly tile, a curtain tile). Those had their mass suppressed in 2-D and never uploaded to GL, so walls vanished and lights and signs hung in the air. The 2-D pass now reads membership of the set the collection fills, which can't disagree. No synthetic scene caught it: every test city is plain `bt` tiles with no marks.

`worldBlend` was the same kind of miss. The 2-D pass fades every world object by it and culls below 0.02, which is how the Mode-7 city gives way to the flat airport scene on the deck. GL collected the whole window regardless and drew the city over the airport on every landing: 17.0% of the frame at `worldBlend: 0` and 12.2% mid-crossfade, now 0.00% and 2.78%.

## The skyline past the window (`noteSkyline`)

Everything used to fade out at `VISIBLE_FAR_F` (34 tiles), a corner shop and the Spire alike, because the map window the server sends ends at 36 and nothing past it was known. Now a tower whose drawn height is 14 storeys or more is skyline, and it stays drawn out to its own reach: 34 tiles plus 2.5 per storey, up to 110. The rule is [client/shared/skyline-tall.js](../../client/shared/skyline-tall.js), and both the server and the client import it.

- Height comes from the baked shapes (`BUILDING_SHAPES`), not the floor count. The Solenne is an 8-storey `apartment` whose model rises to about 27 storeys.
- The flight and freelook payloads carry `skyline`: the tall towers outside the window and inside their reach, as `[x, y, bt, bn, flr, ent]` (`skylineNear` in plugins/flight/state.js). The windshield keeps every tower it has been sent, by world tile, so a cab or helm view draws the towers a flight or vantage received.
- Past the window the tower is the same model: on GLASS 2 a GL cell, on the 2-D path an ordinary item. Its fade is pushed out by giving it a negative haze jitter (`SKYLINE_BASE_FAR - reach`), since the shader dissolves over `FAR - jit`. Inside the window a skyline tower gets the same jitter, so handing over at the window edge swaps one copy for an identical one.
- The governor's shortened `FAR` doesn't apply to a skyline tower on the 2-D path.
- `GL_TAKEN` marks a cell by identity, so each skyline record keeps one cell object for good.
- Gate: `scripts/shapes/skyline.mjs` paints a cockpit 54 tiles south of the Spire on both renderers.

## Model quality board (`npm run models:quality`)

Every model is scored out of four on things the renderer already produces: a roof face, a light at night, more than one wall palette, and any trim. At the start 8 of 173 models had any trim and 5 scored four; later it was 143 and 107. It's a report and not a gate (`--fail-under N` exists for when the pass is done), because a gate would fail as soon as someone added a model and until they finished it.

- The light metric first counted gradients and blurs on the stub ctx, which can't see a glow: `glowPool` blits a `glowSprite` bitmap built once on its own canvas and cached per colour. So buildings lit only by glows and beacons scored dark, and the board reported 109 of 173 dark after nightfall when the real number was 14, mostly ones that should be dark. `shapeAdornCost` now runs with the sprite sink installed and counts what lands in it.
- `RENDER_TUNE.drumTier` (2026-09-27): the shaft rule (height over three radii) left every rotunda bare, so a drum that's a real storey takes one head collar, two per building at ten facets (+1.8% mesh). With that and six palette fixes the board reads 312/312 with more than one wall palette and 310/312 with trim. The two without are `NO_KIT` (the pontoon, the lighthouse). The six dark models are dark on purpose: the Terminus wall, a ruin, the thorn wall, Deadwater's standpipe and dam, and Fallow Provisions.

### Trim

Trim is keyed on the arm, not the model record: a `detail` list hangs geometry on surfaces, and the arm decides where those are, so one list serves every record the arm draws. `m.detail` still wins. This required moving the detail layer out of `drawAuthoredModel`, since the 172 hand-written arms have records too.

Most trim is derived. 156 models had none, spread over 139 distinct arms (at most four models per arm), so authoring meant 139 lists each written against one arm's heights, where one misread number floats a coping band over its building. `derivedTrim` reads `shapeForModel`, the same data collision, shadows, occluder hulls and the cold open use, so a band can't float regardless of which arm drew the building. Trim went from 17 to 143 models for +0.36% frame cost.

- It resolves to absolute numbers, because `draw3DBoxAt` clamps a half-width to 0.44 and a clamp needs a resolved value.
- It sorts candidates by height. The first version took `lodOrder().byIndex.slice(0, 2)` assuming it was ranked, but `byIndex` is re-sorted into source order before it's returned (the ranking survives only as each entry's `at`). That picked the first two segments drawn, usually the plinth and ground box, and put a coping band round every building's ankles, so buildings looked like they were rising out of the ground.
- Trap: the guards must run before the list is built. The derived list asks `shapeForModel`, which captures by running the same arm again; building it before the `SHAPE_SINK` test makes a capture re-enter itself. It terminates and draws correctly, so it showed only as 8,435 mesh faces becoming 101,400.
- Author a wall-mounted part at the footprint (`[1,0,0]`), not the box's own half-width: with the 0.44 clamp, a part placed at `1.14` floats off the side.
- A part stands physically off its face (`FACE_EPS`). `lift` only changes painter order, which means nothing to a depth buffer, where a panel in its wall's plane z-fights.
- Where trim draws follows the framerate contract. It's the cheapest canvas work there is but there's a lot of it (four arms measured +3.3% calls, all flat fills, `grad` and `blur` unchanged), so in 2-D it draws at `ADORN_NEAR` only, bounded by how many buildings are near you. In the mesh it isn't gated, because the depth buffer draws it for nothing.

Two GL bugs found along the way: the pass lit the city from a fixed north-west fill (`glLightState` had no sun; it now takes `LIGHT_STATE`, the light the arms shade against this frame), and it magnified wall textures with LINEAR where GLASS smooths only on minify, which turned near facades into a grey wash that looked like a lighting fault.

### Ground objects and occlusion

With the mass on the GPU, the 2-D queue has nothing to sort scatter, trees, lamps or people against, so `groundHidden` probes the occluder field the frame already built.

An earlier note claimed a wood behind one-storey warehouses drew through them and blamed `OCC_SHRINK`. Both parts were wrong, having come from a screenshot. Zeroing the shrink changes nothing (442 probes, 0 hits either way) because at that range the trees stand on ground projecting above the sheds' rooflines. Compared against the building's own silhouette with the clock frozen, the wood contributes nothing: 1,030 badly-differing pixels with the trees, 1,187 without. Treat a difference seen in a screenshot as a hypothesis and measure it with the harnesses.

## Ground shader (`RENDER_TUNE.glFloor`)

On by default; 0 puts the software raster back. `drawMode7Floor` was the last large GLASS 1 piece with no GL path, and without it switching the 2-D renderer off leaves no ground. It was also the biggest fixed cost in the frame: a per-pixel software raster that costs the same over empty desert as over a city, and the reason `PERF_DS` exists.

The texel loop was already a fragment shader in JS: it inverts the projection to a world point, samples a per-tile LUT and layers material on it. `client/game/js/panels/gl/floor.js` is that function on the GPU: one screen-filling triangle, the LUT as two RGBA planes cached on the LUT object's identity, and `gl_FragDepth` written from the recovered forward distance (one triangle has one depth; the ground has many). `__glFloor()` in the Modelshop over sixteen scenes: worst 2.30% of pixels differing, 0.10–0.72% mean colour. `__glFloorCost()` on a cab frame: 32.9 → 1.3 ms in a city, 65.4 → 0.6 over open sea. GLASS 2 with the 2-D floor still under it cost about what GLASS 1 does on three of four scenes, so moving the mass, trim, lights and signage bought almost nothing until the floor moved too.

- The pass ran before `g.view.draw()`, which starts with `gl.clear(COLOR | DEPTH)`, so the floor was drawn and wiped each frame and the visible "floor" was the 2-D backstop wash. All five shader debug modes returning identical pixels exposed it.
- `stripeA` records lane markings into `GROUND_MESH`, but the tile fill under them was a plain `ctx.fill`, and the GL canvas is blitted over the 2-D pass. Once the floor went opaque, roads vanished and markings hung in the grass. `GROUND_FULL` (the GPU owns the whole ground, only when it owns the floor) takes the tile fill at `SURF_EPS` and the kerbs as quads whose half-width is solved for the tile's distance, since a 1.5 px stroke is a screen width and a quad is a world one.
- Four surfaces share the ground plane and are ordered by z lift: floor 0 < `SURF_EPS` < `ROAD_EPS` < `SHADOW_EPS`. `f` is ground distance with no height term, so a higher quad covers a screen row whose floor is further away.
- A shader that fails to compile looks like one that draws badly: the pass catches the throw, sets the flag to 0 and finishes in 2-D. `npm run gl:glsl` ([scripts/shapes/glsl-smoke.mjs](../../scripts/shapes/glsl-smoke.mjs)) checks that every `uXxx` a shader uses is declared in it and every name the JS asks the linker for exists. A missing uniform location is `null`, `gl.uniform1f(null, x)` is a legal no-op, and the shader reads zero for ever.

### Fallback condition

`drawMode7Floor` hands its LUT and camera over and returns without drawing, so it must test `TUNE.gl` as well as `TUNE.glFloor`. Every GLASS 2 failure ends at `RENDER_TUNE.gl = 0`, and this function runs before the pass each frame; without the `gl` term the early return keeps firing on a machine that can't draw the replacement, leaving no floor at all, permanently. It's hard to notice because the backstop gradient underneath is smooth and the right colour. At the switch, 69% of the ground differed from the software raster without the term and 0% with it.

`npm run gl:floorfallback` ([scripts/shapes/floorfallback.mjs](../../scripts/shapes/floorfallback.mjs)) checks it headlessly against a hook that returns nothing, one that throws, and no hook. Its signal is `putImageData` on the Mode-7 scratch buffer, because the floor is one `drawImage` either way. Trap: the counter must go through a proxy, since the DOM stub's context is itself a proxy that synthesises methods on `get` and silently discards a wrapper written onto it, which looks like the floor never rastering.

## Clip plane fitting (`RENDER_TUNE.nearFit`)

The **Fit near plane to seat** slider; 0 is the fixed 0.06 tiles GLASS 2 shipped with. Symptom: grass showing under the road with the camera flat on it; raising the eye isn't an option for that seat. The nearest ground a frame shows is `EH · depth / (H − horizonY)`: about four tiles for an aeroplane at eye 0.24, but 0.049 for a camera at the 0.05 floor `makeCam` enforces. That's inside 0.06, so the bottom tenth of the frame is ground no geometry reaches (no road quad, kerb or lane marking) and only the floor draws there, showing terrain. `nearFor` in gl/camera.js solves the plane from the camera.

- It only moves the plane closer. `NEAR` is the ceiling, so the cockpit (wants 0.228), the cab (0.139) and every chase seat get exactly 0.06 and keep their depth precision; this is asserted per seat with `Object.is`, because the claim is bit-identical matrices. Only the street seat (0.0455) and a free camera on the deck (0.0379) change, costing 1.3–1.6× coarser depth. The ground layer's z-fight defence is `polygonOffset` in depth-buffer units, so it's unaffected.
- GLASS 2 only. In the 2-D painter 0.06 is a clamp inside `proj`, written as a literal at twenty call sites that test `p.f <= 0.06` for "behind the eye", so changing it there is a much bigger job; `RENDER_TUNE.gl = 0` still shows the band.
- Mass, ground, floor, sprites and strokes share one depth buffer, and two passes built from different near planes disagree by a hair that looks like z-fighting. Three places had their own copy: `gl/floor.js` had a literal `const near = 0.06, far = 400.0` (the second copy the warning on `NEAR`/`FAR` in camera.js is about), and `sprites.js` and `strokes.js` computed their `uAB` z row as module constants, a half-tile depth error once a seat fits its own plane. All three use `zRow(cam.near)`; `cam.near` is set once per frame in world.js because every pass gets the same `cam`. The floor is the one place it can go missing, since it's driven entirely by FLOOR_STATE.
- It's solved under pitch, since a tilted camera is the one that looks down steeply enough to matter; the solve matches the shipping matrix to five decimals at 14°.

Gate: `npm run gl:nearfit` ([scripts/shapes/nearfit.mjs](../../scripts/shapes/nearfit.mjs), in `shapes:smoke` and the `pretest:regress` chain). It searches the shipping matrix for the ground distance that lands on the last row and compares its clip `w` with the plane. Trap: it can't use `cam.proj`, which clamps `f` at 0.06, so the search would answer 0.06 for every seat. Its mutation control is three named seats that must be clipped with the fixed plane restored, because `NEAR_FIT`'s cushion moves the plane slightly on seats that were already reaching. Trap: a whole-frame hash can't show "nothing changed"; two renders of the same cab frame differ because clouds drift, birds fly and lights fade. The arithmetic is the proof.

## Option allowlist (`npm run gl:opts`)

`installGL()` passes the world pass an object literal that's an allowlist, not a spread. An option added at the windshield end but not there is dropped one step short of the shader, and it looks like a feature that does nothing: the tune key exists, the slider moves, the uniform is declared, and the bench reports 0.0% at every strength. Contact occlusion shipped that way for an afternoon, and the baked per-vertex AO term right after it, despite being wired, gated, measured and swept. [scripts/shapes/glopts.mjs](../../scripts/shapes/glopts.mjs) brace-matches that literal and requires every `opts.X` world.js reads to be a key it passes. An exception must give a reason, not just a name. It blanks comments first with the shared scanner ([scripts/lib/blank-scanner.mjs](../../scripts/lib/blank-scanner.mjs), also used by `imports:smoke`), because the file is mostly prose and a raw regex picked up 'afternoon' and 'produces' as option names.

## Vertex streaming ([gl/stream.js](../../client/game/js/panels/gl/stream.js))

Eight layers (mass solids, ground, strokes, sprites, decals, billboards, clouds, the Curtain) fill a growing `Float32Array` and upload it once a frame. All eight used `gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW)` followed by their full `enableVertexAttribArray` + `vertexAttribPointer` block. None of the three problems with that shows in a picture:

- `subarray` creates a typed-array view per layer per frame, at the point where a GC pause is most visible. WebGL2's `bufferSubData` takes a source offset and length, so no view is needed.
- A `bufferData` with a size is a reallocation, and the vertex count changes every frame, so the driver was asked for new storage nearly every time. Capacity is now a high-water mark grown by doubling, so a layer settles within a few frames and stops asking.
- Attribute pointers are recorded in the VAO against the buffer bound at the time, and `bufferData` replaces a buffer's contents without changing its name, so re-binding after every upload is unnecessary.

Measured in the Modelshop with the calls counted on the prototype, over 10- and 60-frame runs of the same five seats: `bufferData` 15 and 15, `vertexAttribPointer` 165 and 165 (flat, so setup only), against `bufferSubData` 734 and 3,134, the 9.6 uploads a frame that should scale.

- There's deliberately no orphaning. The usual `bufferData(size)` before each `bufferSubData` avoids a write-after-read stall and is exactly the per-frame reallocation this removes; if a stall is ever measured on real hardware, it goes back in the helper once.
- No harness here reaches a GL draw call (each installs a hook that returns null), so a buffer-management regression is invisible to all of them. `npm run gl:stream` ([scripts/shapes/glstream.mjs](../../scripts/shapes/glstream.mjs), in the `pretest:regress` chain and `shapes:smoke`) drives the helper against a recording context, checking what the driver was asked for, and sweeps the directory, not a list of names, so a new layer written the old way fails. Mutation-tested 8 of 8. Its `bufferSubData` check uses object identity, since "a Float32Array arrived" is also true of a fresh view.
- Uniform matrices: `mat4f` in camera.js holds one scratch `Float32Array(16)` for the eight layers that each wrote `new Float32Array(viewProjMatrix(…))` per draw. Trap: never keep what it returns; it's the same object every time. Code that needs to keep a matrix takes the plain Array from `viewProjMatrix`.

## Ground buffer caching (not done)

`gl/ground.js` rebuilds its whole vertex buffer every frame with no cache key, and `GROUND_MESH` is refilled each frame in map-window tiles, which looks like a candidate for the mass buffer's caching. It isn't worth it:

- The quads depend on the camera. A road quad's alpha is `sq.a * ctx.globalAlpha`, where `globalAlpha` is the far fade, and a kerb's half-width is solved for the tile's distance. A window-keyed cache would need the fade moved into the shader and kerbs expanded in a vertex shader as `strokes.js` does for wires, both visible changes.
- The phase costs nothing: `__glPhases()` on a 1280×720 aerial seat reads `ground` at 0.00 ms with the GL floor on, against 0.86 ms for the old 2-D path.

Trap: a cold first run of that harness gives wrong numbers: `world:build` 12.2 ms (GL dearer than 2-D) and `world:fauna` 3.40 ms against 0.44, where the second and third runs give 6.0–6.9 ms against 9.5 and 0.03 ms. Take three runs. The settled CPU cost in a GL frame is `world:build` ~6.5 ms and `world:arms` ~3.8 ms (running the model arms and collecting adornments every frame for geometry that doesn't change), with `world:gl` (the submission) at 2.4 ms and `world:occlude` at 0.7 ms. The next optimisation is there, not in the ground.

## Fidelity readings

`__glFidelity()`'s documented 1.0% is out of date: it now reads 4.7% and hasn't regressed. Against a detached worktree at `6468131a6` on its own Modelshop port (never swap live files), HEAD reads 4.7% and the working tree 4.8%, inside run-to-run spread (`office/13` 7.0 → 4.4, `clinic/13` 8.9 → 8.5 across two runs of one build). The rise is deliberate GL-only shading added since: material BRDF, recovered relief, SSAO, HDR, contact occlusion, baked AO. Only compare a fidelity reading with another taken the same week; a number in a doc header isn't a baseline.

## Facade glazing bands (`RENDER_TUNE.glBand`)

0 puts back the punched grid and two-pane shopfront. The derived kit now builds one continuous glazed band divided by mullions, as Voltage's authoring note prescribed.

- It's cheaper: a ribbon with five mullions is 11 faces against 40 for five punched bays. Window-bay parts across the registry fell 1,827 → 982 and the registry mesh 39,754 → 36,833 faces (below where the signage pass started), while lit shopfront area rose several times over.
- The lit roll moves from the pane to the floor (a ribbon reads as inhabited because some floors are dark). `litN` still counts rooms, so the facade wash is unchanged.
- Rich list only: `bars` is mesh-only, so on the 2-D painter a ribbon would be one undivided slab.
- The door stands proud of the glass. A dark bay at the same plane is a depth coin toss, and the band's glazing sits at a higher lift than the door surround, so the doorway would end up behind its own shopfront.
- Trap: `glBand` and `richKit` need a page reload. The mesh memo and GL vertex buffer key on object identity and `meshParams` carries neither flag, so an A/B is two page loads; two panels in one pass render the same mesh twice.

## World text on the depth buffer (`RENDER_TUNE.glSign`)

0 puts back the strips. Names on parapets, stencilled bay numbers and painted price boards were drawn in GLASS 1 as eight affine strips per sign, because a 2-D canvas can't map a texture through a perspective divide. On the GPU each is one quad through `gl/decals.js` (as the marquees are), with the artwork still baked by the same 2-D code. On a 35%-built cab frame: `drawImage` 481 → 1 (the GL blit), `transform` 480 → 0, `save` 488 → 8, canvas calls 50,691 → 48,771.

`cam.unproj` (the full inverse of `proj`; each projected point carries its `f`) recovers the world quad, so no caller keeps a world-space copy. It returns null under pitch. The one site whose probe points differ from its drawn quad stays 2-D.

Trap: a sign is paint coplanar with its wall, so a depth tie loses and the lettering silently disappears. The 2-D queue couldn't fail that way because `DECO_LIFT` sorted adornments 0.6 tiles ahead of their host, which had been hiding a geometry bug: The Dry Goods lettered its false front on a plane a tenth of a footprint inside its board (fixed at the model). `cam.unproj` takes a `pull` that slides a corner along its own view ray toward the eye (`sx`, `sy` are ratios in `f`, so only depth changes; this is `FACE_EPS`'s job, done where the ray is known).

`__glSign()` in the Modelshop A/Bs signage drawn two ways, so every differing pixel is lettering. It sweeps all four facings from three tiles off-axis (as `gl:mesh` captures four), because at grazing angles parapets and cornices cross the lettering plane and the inset that matters is along the view ray. Result: 72 cases, 55 exactly 0, worst 0.020% (letters genuinely behind a parapet), against 0.062% with the geometry bug restored.

## Sort bias versus depth offset (`DECO_PULL`, `BLADE_PROUD`)

`DECO_LIFT` (0.6 tile) is a queue position in the painter's order. `emitDecoQuad` and `emitDecoFill` were spending it as a `cam.unproj` pull, moving the part 0.6 tile through the world. A host's near wall is ~0.44 from tile centre and a neighbour's ~0.56, so a blade on the far face of its bar came out in front of the near face (reverse side showing), and a front blade cleared the building in front too. The pull is only a tie-breaker, so it's capped at 0.05; a caller asking for less keeps its number.

`neonBlade` is the exception. Its arms author the anchor inside the facade (`type:bar`: 0.16 tile forward against a front wall at 0.328), so at a tie-breaker pull only the part cresting the roofline draws. `BLADE_PROUD` = 0.25 clears the deepest facade and stays under the near face of a building one tile in front. It's a pull, so `sx`/`sy` and GLASS 1's picture are unchanged.

## Sign culling (`cull` on a decal)

A two-sided textured quad reads mirrored from behind (Voltage's roof sign read "ƎƆATJOV" from the back). The board or wall behind is already drawn opaque in the mesh, or as its own flat decal per tile, so `emitSurfaceText` and `marqueeBand` mark their decals `cull`.

- The front of a sign is `gl_FrontFacing == false`. Quads arrive TL,TR,BR,BL (reading order), which is clockwise in NDC when facing you, and clockwise is the back face under default CCW winding. Inverting it hides every sign you face, so the polarity is stated in the shader.
- `cull` is in the batch grouping key. It's a per-draw uniform, so two decals sharing a texture but disagreeing on it would otherwise share a batch.

## Sign lettering range (`RENDER_TUNE.signFar`)

0 restores the three-tile shed. Reported as "all signage, mandarin and english, are not showing their text at all". A derived-kit board, gantry or blade is in the per-model mesh (captured at `ADORN_NEAR`) and drawn at every distance, but its lettering is a per-frame decal from the tile's name, emitted only by `detailLayer`, which returned beyond `RENDER_TUNE.detailNear` (3 tiles). Measured on one shop at a fixed world tile (so its kit roll can't change): 17 decals at two tiles, zero at three through fourteen, board visible throughout.

Trap: a `$name` board's slab is a per-tile `paint` quad, so it's in no per-model mesh; beyond the ring it was absent, not blank. The fix lets that quad through and suppresses every other, since lettering over a missing board floats in mid-air.

Raising `detailNear` was already measured and rejected (`signfloor.mjs`: 3→6 took a dense night block 21.0 → 24.3 ms, 3→9 to 36.2). Instead, beyond the ring the pass runs with every part that letters nothing skipped and every quad except a `$name` board suppressed. `framecost` is unchanged (the 2-D painter never takes this path: it needs a live decal sink), and a real Coldwater block costs +60–70 decals a frame for 1.5–3× as many lettered signs. The distance follows legibility: 309 px of sign at three tiles, 80 at six, 38 at ten, 24 at twelve on a 1200-wide frame (about seven at the game's 640).

Frame time fell inside `__glFrame`'s spread on a hidden pane; the evidence is `calls2d` (unchanged) and the decal count. The gate is `node scripts/shapes/signrange.mjs` (no npm name), the sibling of `signfloor` one ring out; its mutation control: 119 of 196 models lose lettering with the flag at 0.

Trap: the range is measured from the eye, not the vehicle. A building's `dx`/`dy` in the sweep are offsets from the vehicle, and `cam.ex`/`cam.ey` are where the eye is in that frame (on the vehicle in a cab, `back` behind it in a chase view, anywhere on a detached free camera). The range, `detailNear` and the `lodNear` ring all go through `eyeRange(cam, dx, dy)`. Reported 2026-10-04 as "embassy no signage" from a free camera: the Embassy and Layers were a few tiles from the camera and more than 12 from the truck, so the boards drew from the mesh with no names and no window lights. `signrange` now also checks every model six tiles in front of a free camera 18 tiles from the truck; against the old code 164 of 319 models failed it.

## Sign occlusion probe removed on GL

The follow-up report, "most signs fixed, just not all mandarin character signs": the hanzi blade is just the only lettered blade the derived kit hangs. `emitSurfaceText` called `decoHidden` before every push. That's correct on the 2-D path, where the probe is a sign's only occlusion, but on GL it second-guesses what `gl/decals.js` already resolves per pixel. The probe is all-or-nothing against a rasterised field with a bias, shrink and grow, so its errors only ever delete visible signs, worst for blades, which hang off a corner partly behind their own facade. On the Solenne block at night 30 of 62 signs were dropped at one heading and 12 of 14 at another; now 0 at all four, sign counts 2→14, 32→66, 43→64, 12→15.

Nothing draws through buildings as a result: the same shop behind a nine-storey wall contributes 0 pixels without the probe (depth clips every quad) against 88,837 in clear air. `glowPool` stopped probing for the same reason. The canvas fallback keeps its probe (`emitDeco` does its own), so `SIGN_TALLY.hidden` counts 2-D fallback drops and should read 0 in a GLASS 2 frame.

Trap: no headless gate can see this. The probe reads a field a real frame rasterises, so under `canvasResidue` it answers false. Use `signTally()` on a painted frame.

## `__glLeak` can't see the detail kit

A green 173-model run proves nothing about signs. Its subject stands at eight tiles and `detailLayer` runs only within `RENDER_TUNE.detailNear` (three), so no board, blade, canopy, pipe, lamp or neon run is ever emitted into its frame (the same blindness `glresidue` had). Moving the subject doesn't help (the three-row wall either swallows it or stops covering it; 98 of 173 then draw almost nothing over it, and the restored bug reads zero either way). It needs one low occluder in front of a subject two tiles out. Until then, check by eye: reverse `ent` so the sign is on the far face.

Its noise floor is now measured with the subject present (the wall-only floor missed blink phase, stack smoke and cache evictions, reading 0 while fresh-page re-runs moved 0–300 px). It still moves (65 and 79 px), so a row just over it is a question; the unpinned source is unknown (clock and `Math.random` are pinned).

## Sign typefaces (`signFontOf`)

`SIGN_TRADE` named a hand for 40 of 173 models and the rest got bold monospace; an arm's own signage passed `bakeSignText` no options, so every frieze, false front and blade was mono regardless. The hand is now derived on the axis `accentOf` uses for colour: the trade's if the table names one, else the material family (what a building is faced in best indicates when it went up). Six faces (`deco` and `condensed` are new), published through `_signFace`, like `_bladeSign`.

- A works keeps the typewriter (stencil on steel), and `plain` (51 models, nearly all Terminus and the Thornwarren) falls through to it.
- Trap: the hand mustn't change the sign's size. Most callers map the baked canvas onto a quad sized against the reserved box (a cell per character), so the texture aspect is a contract. Measuring ink instead would make a serif "THE MERIDIAN" half the width and two-thirds too wide on an unchanged frieze. The ink is measured but the box is kept, growing only if a face overruns. `tight` (the road sign, which fits its quad to the texture) is the exception.

## Declining kit sections (`KIT_DECLINE`)

`have` keeps the kit out of a section somebody has drawn; `KIT_DECLINE` keeps it out of a section nobody should. One entry: `meridian`, a 1930s deco apartment landmark (stone lantern under a verdigris cupola, name cut in a limestone frieze), which was getting a backlit hoarding on legs over the roof. The rest of its kit stays. Add an entry only if the part would be wrong on that building whoever built it; an arm with preferences about its own facade should draw the facade.

One section exists only to be declined, because no arm draws it: `paint`, the kit's graffiti pass, since every piece it places is a word. The six Old Coldwater trades decline it through one list, `SLUM_DECLINE`. See [old-coldwater.md](../proposals/old-coldwater.md#the-shanty-pass-2026-09-28).

## What's left on the canvas

The world is on GLASS 2, but `windshield.js` stays: it runs the 173 arms producing mesh, lights and decals, owns the scene, occluder field, LOD and collision, and draws the overlay. GLASS 2 is its rasteriser. With the dial pinned, at 640×360 a cab frame is 2.8–3.6 ms and an aircraft frame 6.5–8.3 ms, the city is the smaller part (1.1–3.7 ms), and the 2-D adornment queue is 43 faces. The remaining canvas overlay (ridge, sky and clouds, weather, dash, glass, badges) should stay: no ordering problem, no measurable cost, and moving HUD text would need a glyph atlas.

## Measuring the frame (`__glFrame()`)

`__glFrame()` in the Modelshop exists because "what to port next" was answered wrongly three times:

- Hand-picked models pick the answer. Eight chosen names put the 2-D queue at 1,597 faces and called it the biggest item left; one was The Meridian Lobby, whose gargoyles are 44% of all faces the 173 models emit. Across the registry the queue is 861 faces, mean 5 a model, 63 models emitting none.
- A loose resolution dial sheds resolution where the frame is expensive, so a storm measured cheaper than clear sky and night cheaper than day.
- A call count isn't time. `drawSkyline` is 492 of the ~1,800 remaining calls and is two filled 241-point polylines with a median of 0 ms over 200 reps; storm weather is 1,477 calls and doesn't move the frame.

The harness reports a spread because the same seat gave the occluder pre-pass an 8.4 ms cost and a 6.7 ms saving in consecutive runs (which nearly got it deleted). A difference inside the spread isn't a finding.

## Hardware coverage

`glCapabilities()` answers "will this machine run it" from a throwaway context, checked against the WebGL2 standard. The pass needs 8 vertex attributes (guarantee 16) and 13 varying components (guarantee 60).

Trap: the texture page. The guarantee is only `MAX_TEXTURE_SIZE ≥ 2048`, and at `texRes: 2` every surface wants 2048×4096, which on a floor-spec device is a silent `INVALID_VALUE` and a black-textured city. `buildAtlas` takes the device limit and refuses a page that won't fit, dropping to flat palette colours with one warning. Packing balances on the cell rather than the count, bringing the `texRes: 1` worst case to 2048×2048; a typical frame is 256×512.

Other hardware is untested: every number here is one machine with a discrete NVIDIA card, and falling back correctly doesn't mean fast on an integrated GPU. If it measures slower somewhere, try `antialias` in `createGLView` first: the 2-D canvas has no MSAA, so GL buys smoother edges at full-frame cost.

## A pass that didn't draw

The mass is suppressed because the GL pass exists, so a pass that returns nothing leaves floating lights over no buildings. No WebGL2 and a driver removing the context both get there without throwing, so the pass returns null and the flag goes back to 0, as with a throw. The context-lost listener calls `preventDefault` (otherwise the loss is permanent) and `lost()` is checked every frame.

A draw can also be dropped on its own, with only a console warning: "Feedback loop formed between Framebuffer and active Texture" means the program samples a texture that's attached to the framebuffer it's drawing into, and the driver skips the draw. The one found (2026-10-03) was the cabin's room shadow: `shadowPass` in gl/solids.js built its framebuffer before saving the caller's, so on the frame each scene built its map the room drew into its own shadow map and was missing. Save state before building anything. To find the next one, wrap `drawArrays` and friends on `WebGL2RenderingContext.prototype` to call `getError()` after each draw, and on `INVALID_OPERATION` compare each active sampler's bound texture with the draw framebuffer's attachments and keep the stack. Don't query `DEPTH_STENCIL_ATTACHMENT` in that probe: it raises its own error, which the next draw's check then blames on itself.

## Phones (2026-09-28)

Three things in windshield.js exist for phones. None of them runs in the smoke suite, because every DOM stub's `matchMedia` answers false.

- **Phone tier (`GL_TIER`, `PHONE_TIER`).** A coarse pointer on a screen whose short side is under 600 CSS px starts with `glSsao`, `glShadow`, `glMsaa` and `glHdr` at 0. Each is an exact off switch that gives back the picture from before it shipped. It is decided once at load, because `glMsaa` is a context creation attribute. localStorage `architect_gl_tier` = `full` opts a device back in.
- **Revival after a lost context.** When the pass turns GL off itself (`glAutoOff`), the next `visibilitychange` to visible sets `RENDER_TUNE.gl` back to 1, at most twice a session (`GL_REVIVE_MAX`). A backgrounded phone tab is the common way to lose a context. The player's own GLASS 2 switch is never overridden, and the world-pass throw inside `drawWorldObjects` (a code fault, not a lost context) still switches GL off for good.
- **`glass:struggling`.** On a coarse-pointer device, a view that keeps its smoothed frame interval above 85 ms for six seconds of painting fires this window event once a session. Gaps over a second (a hidden tab) don't count. main.js answers it once per device with a log line offering `displaymode textgames`.

The cockpit's two frame loops (`fsimFrame`, `hudFrame`) are wrappers around `…Body` functions now: a throw is logged once and the loop re-arms, so a bad frame no longer ends the flight.

## Releasing GL scenes (2026-09-17)

Failure paths were handled but nothing was released. A scene owns a context and everything on it (programs, vertex buffer, atlas page, HDR chain, shadow map, mirror target, up to 448 cached textures), and `disposeWindshield` only cleared the 2-D scene, so a closed seat held all of it for the life of the page. Bounded for the three fixed seats; unbounded for the helm, which mints a canvas id per wheelhouse (`helm-chase-<random>`).

The browser caps contexts at 16. Measured: 24 opens made 24 contexts, and from the seventeenth the browser force-lost one per open, oldest first, which is usually the seat being flown or driven. So closing a wheelhouse blacked out the cockpit. At 156 MB a scene (1920×1080, dpr 1: 63 MB MSAA×4 float colour, 24 MB depth, 12 MB shadow map), sixteen resident scenes are ~2.5 GB, enough to crash the browser.

- Dispose calls `loseContext()`, which frees everything in one call; there's no per-object dispose to write and garbage collection isn't a budget. The entry is `glDisposeScene` in world.js via `installGLDispose`, because windshield.js mustn't import gl/.
- `MAX_SCENES = 8` evicts the least-recently-painted scene (not Map insertion order, which would evict the live seat), so a caller that forgets to dispose costs a rebuild.
- Trap: no headless gate reaches a context (every harness installs a GL hook returning null). Measure in the Modelshop with `HTMLCanvasElement.prototype.getContext` patched to count `webgl2` creations and `texImage2D`/`renderbufferStorage` patched to tally bytes. Branch on arity: the 9-argument overload carries width and height, the 6-argument one format and type enums, and reading 6408×5121 as a size reports 2 GB for one frame.

## Fidelity measurement (`__glFidelity()`)

`__glFidelity()` in the Modelshop measures whether GL looks like the same city (replacing a non-reproducible 6.8–12.7% README figure); 1.0% when written, 4.7% now (see first section).

- It compares one building alone from a fixed seat, because a whole-frame diff measures coverage (GL draws the whole window and lights reach 22 tiles) and would count improvements as error.
- The clock is frozen: two renders of the same empty scene differ by 98,000 pixels (drifting clouds, birds, water).
- Two fixes closed the gap. The far edge staggers: each tile dissolves at its own moment, up to three tiles inside the limit, instead of a whole row at once (one expression, `hazeJitter`, two readers). And a barrel roof carries the painter's own shade (the one self-lighting mass primitive, worst case 3.0%). `flat` is a lighting setting, not a kind, so a barrel stays mass and `gl:mesh` still checks it.
- What's left is `emitFlat`'s hairline stroke, inside the noise.

## Archetypes in the occluder field

A `building_type` without its own model is drawn by the shared biome set (`drawBuilding`, not `drawTypeModel`), and `shapeForModel` returned null for it, so the pre-pass skipped it: `luxtower`, a thirty-storey tower, let contacts, lights and the own ship through. Capture now dispatches on the arm, so archetypes capture through the same primitives, sink and affine solve as the 172 models. `shapes:smoke` holds all eleven to the same two checks (it captures; it's affine at an unseen scale), with the list derived from `BLDG_TYPE_3D`. framecost fell 278,336 → 277,545, with eight fewer `shadowBlur` passes from signs that had drawn through buildings.

## Night lights past `lodNear`

`lodAdorn` sheds lights past `lodNear` because on canvas they're expensive, and a cab's `lodNear` is nine tiles, so the far end of a lit street went dark from a truck. As a depth-tested quad a glow is six vertices, so with the sprite sink installed `glowPool` sheds at a beacon's tier and the window bloom cull opens from 8 to 22 tiles. GL only; with the flag off the ladder is unchanged.

## Adornments on the depth buffer (`RENDER_TUNE.glDeco`)

The **GL adornments** slider; 0 puts it all back. After the lights, Curtain, marquees and world text moved, what remained on canvas were strokes (masts, lattice legs, catwalk rails, guy wires, crane jibs, light-runners on tower corners), a few screen-space billboards (blades, dishes, crosses, a perched buzzard, windsocks) and flat world polygons (helideck markings, forecourt paint, price boards). All still painted on the canvas composited after the city, guarded only by `decoHidden`, which hides a surface only when it's entirely covered, so a blade proud of a roofline drew in full through the building. That caused every "showing through a building" report.

### Strokes

A stroke's screen width can be expressed in a vertex shader: `client/game/js/panels/gl/strokes.js` expands two world endpoints and a pixel width into a quad (as the sprite layer expands a light), six vertices per segment, no texture, one draw call for every wire.

- A baked billboard was tried and removed: `markBillboard` re-bakes per instance per frame (repaint plus `texImage2D`), fine for a few landmarks but below GLASS 1's framerate for parts on ordinary buildings.
- A 0.8 px brace is drawn one device pixel wide at 80% alpha; width is floored at one device pixel and the shortfall goes into alpha, or a lattice breaks into dropouts.
- A neon wire's night `shadowBlur` halo is one more quad, additive and sorted last.
- A core stroke can carry a soft edge: `feather` below 1 fades its sides over that share of the width. A wire leaves it unset and stays hard, and 1 is still the halo's glow profile.

### Rain columns (`RENDER_TUNE.rainColumns`)

Heavy rain seen from a distance: `drawRainColumns` in windshield.js hangs soft grey strokes (`tag: 'raincolumn'`) from the cloud base to the ground across the heavy core of each precip or storm cell, with the foot raked downwind. It's armed beside the world rainbow and spent in the world pass with the sinks open. Being on the depth buffer, a building in front hides a column and a far one is a thin stripe on the horizon.

- Only while something is falling (`field.falling`), never snow, and only for a cell whose strength times `precipScale` clears `RAIN_COL_MIN`.
- Nothing within `RAIN_COL_NEAR` (4 tiles) of the eye, because the canopy's curtain is the rain there, and nothing past 70 tiles.
- The 2-D virga in `drawVolumetricClouds` is painted over the finished city, so it skips any cell drawn as a column (`RAIN_COL_CELLS`).
- It has to be darker than the sky. The first cut was a mid grey at 0.15 a band: every stroke drew and none showed against a storm overcast.
- Many overlapping bands, not a few spaced ones; spaced out they read as a row of pillars.
- Under water the GL pass empties the stroke list, so a free camera parked on the bay shows none. Judge it from land.
- Gate: `scripts/shapes/raincolumns.mjs` (heavy draws; light, snow, roll-off, out-of-range and switched-off draw none; every band in the core, ground to base, laid over the scene with a soft edge).

### Billboards, fills and recesses

Each part goes to the layer matching its shape, keyed on appearance, never the camera: a screen-space billboard becomes a decal via `cam.unproj` (`emitDecoQuad`), a flat plain-coloured world polygon becomes a decal directly (`emitDecoFill`), a smoke puff becomes a sprite.

- `emitFlat` into the mesh is deliberately not used for some of these: a mesh is captured once per model at a fixed hour and shared by every tile, so a surface whose colour depends on night (a doorway warmer after dark) has no single answer.
- A recessed opening (`slideToPlane`/`emitRecessBay`) was painted as a dark rectangle with the back wall over it. At true depth the back wall is behind the facade and gets hidden, and `draw3DBoxAt` can't leave a hole, so for months it was a per-frame `markBillboard` bake at one depth. A point slid along its own eye ray projects to the same pixel, so each interior corner is slid forward into the gable plane: the picture and live parallax are unchanged, and each layer becomes a flat quad in the facade for `emitDecoFill`, depth-tested per pixel with no bake or upload.
- The layers are staggered about `FACE_EPS` apart (well inside `DECO_PULL`), since collapsing them onto one plane loses their order.
- The 1.4 px frame became three quads (jambs and lintel lying in the wall). Only its outer half was ever visible, and as a stroke `emitWire` needs a real pull to clear the mass it's authored in (a rim on a gable under a barrel roof is inside the roof solid), so four segments drew in front of their own building: 42 leaked points in `glself`, now 0.
- The canvas composite stays as fallback where the solve is degenerate.
- Exception: the regional hangar's lit departure lounge stays on canvas. It sits behind the pavilion's own glass and the mass pass writes depth regardless of alpha, so as a quad it would be hidden by that glass. It uses `markHidden` (spanning the pavilion) rather than a single-point probe, and declares itself via `keptOnCanvas` so the gate can allow that one reason without allowing the eight-thousand-line function it's in.

### Gate: `gl:residue`

`npm run gl:residue` ([scripts/shapes/glresidue.mjs](../../scripts/shapes/glresidue.mjs), in `shapes:smoke` and so the push gate) runs every model arm as a GL frame does (all sinks open, `MASS_OFF` and `FLAT_OFF` set) and tallies what still reaches `FACE_SINK` by the function that queued it. The finished frame can't answer that (origins are gone at flush); earlier guesses blamed and patched the mast and dish while `latticeTower` queued thirty-nine faces. It went from 16 painters and 470 faces to one declared exception.

- The gate is an allow-list of reasons, not function names or a budget (a budget passes a new leak whenever an old one is deleted).
- It needs a real camera: these paths reach the decal layer via `cam.unproj`, which a stub camera lacks, so under a stub the census lists only what's already fixed.

### Clearing the host building

`DECO_LIFT` (0.6 tile) also cleared hosts: a mast at tile centre sits 0.44 behind the front wall, a fire stair is inside its wall, a dish sits among crown boxes. On a depth buffer the host wins and the part vanishes (The Dynamo lost its whole external fire stair). So these paths apply the caller's lift through `cam.unproj`, sliding along the view ray: the projection stays bit-for-bit and only depth moves. That's well under the ~1 tile to any building in front, so wires go behind real buildings per pixel.

### Horizontal paint

The Solenne's sky pad markings (aiming circle, touchdown ring, H), lifted 0.6 tiles, showed from the street four tiles away, far below the deck. On the depth buffer the markings sit just above their slab and it hides them; above the pad both renderers agree pixel for pixel. Consequence: no GLASS seat can see a very tall tower's pad markings, because the optical axis is horizontal and the roof leaves the frame before the eye rises above it. Pilot guidance is `drawRoofPadCatch`, separate and unaffected.

### Bakes

A bake mustn't repeat the quad's transform. The Dynamo's wind wheel is raked (`sq`) and its quad is already `R` by `R · sq`; a texture also drawn squashed came out at 0.38 height, nine vanes reduced to a few spokes and the rim clipped. The texture says what a thing looks like; the quad does all the placing.

### Pixel measurement (`__glLeak()`)

Behind thirty-storey towers every model reports zero leak, correctly, since `decoHidden` handles full coverage. The bug is partial coverage, so the wall is a nine-storey warehouse with a taller subject. Twelve models, night and day: 2,700 leaked pixels with adornments on canvas, 588 on the depth buffer, over a noise floor of 648 (Halcyon Towers 400 → 16, the Solenne 367 → 56, The Green Room 194 → 8).

- Settle the clock, don't just freeze it: `fadeLights` ramps over elapsed time, so under a frozen clock no light reaches its slot (one model read 24, 14, 37 on three runs).
- Pin `Math.random`: GLASS throws a meteor on a random timer, and settling the fade advances it.
- The harness prints its noise floor rather than subtracting it; the same map rendered twice differs by a few pixels along the wall's roofline (cause unknown), and a leak inside that isn't a finding.

Frame cost is inside the spread (one sweep read a cab frame 2.6 → 1.9 and 3.2 → 2.2 ms, the next the reverse), so it costs nothing measurable, as expected when two dozen light-runner queue entries each setting `shadowBlur` become two dozen quads in one draw call. A dense night cab frame carries 2,086 strokes, 42 decals and 396 lights on the GPU that were 2-D faces.

## Lights as sprites

Every GLASS light is a world point, screen-pixel radius, colour and alpha, so `client/game/js/panels/gl/sprites.js` draws `glowPool`, `drawCityBloom` and `blinkLight` as depth-tested quads and the occlusion probe isn't used (it was `decoHidden` against a rasterised field with hand-picked bias, shrink and grow, the bug this plan started from).

- The radius is passed in, never re-derived: the same `clamp(k / f, lo, hi)` the painter computes, so retuning one renderer can't desync them. The quad is expanded in the vertex shader.
- A light writes no depth (otherwise two glows on one wall cut holes in each other).
- Additive lights sort to the end of the buffer (a bloom adds, a ground glow lays over; swapping them turns a lit window into a grey smear).
- A light is nudged toward the camera in clip z, since it sits on its surface and would z-fight (the job `DECO_LIFT` does by sorting).

Night cab frame: 9.6 → 7.2 ms, 2,458 faces and 44 lights on the GPU. Lights are cheap to author, though only 14 models are dark. See tools/modelshop/README.md.

## Pixel sizes are device pixels (`npm run gl:dprsize`)

Lights, strokes and billboards size themselves in pixels and convert with `2.0 / uViewport` against the canvas viewport, so producers must scale by `_frameDpr`. `pushLight` and `pushStroke` did; all four billboard producers didn't, so every landmark, scatter species, rooftop marquee neon and air contact rendered at `1/dpr` size.

- It isn't only a hidpi bug: the ratio is `baseDpr × st.resStep` and `resStep` is the adaptive frame-time dial, so the South Gate grew and shrank between screenshots of a parked helicopter. The `dials` harness shows a 14→48→14 ms ramp visiting 0.6/0.7/0.8/0.9/1, a 1.67× swing.
- Trap: it's exactly zero at dpr 1, which every headless harness (`dom-stub` sets `devicePixelRatio: 1`) and every Modelshop scene uses (the same trap as the camera matrix built in canvas units). Sweep ratios.
- The bake canvas must also rasterise at `_frameDpr`, or the landmark is the right size but soft: `markBillboard` and `bakeContacts` do; their size guards stay on the CSS box (a fact about the view, not the display).
- One funnel, `pushBillboard`, instead of four producers.
- `drawMarquee`'s push is unreachable and is a stated exception in the gate: `bldgStyle` only returns arch `marquee` for bt bar/club/casino, a present bt always takes the table over the biome, and all three have `TYPE_MODEL` arms, so `modelFor` answers first and `drawBuilding`'s `case 'marquee'` never runs.

## Road fading

Same dial. Road geometry is world-space and dpr-independent, so what changes is how many device pixels a thin kerb or lane marking covers, and under MSAA a sub-pixel quad draws fainter. From an aerial seat across the dial's range, road quads under one device pixel go 23.3% → 33.7% and mean coverage 0.609 → 0.504. The note at `resStep` predicted it ("the road blinking between light levels"); `deadbandStep` stopped dithering but not the shift when load changes. The kerb solve is floored at half a device pixel of half-width, so a kerb is never thinner than a pixel (a no-op at dpr ≥ 2/3, so it only widens kerbs about to vanish). Lane markings are authored world widths and still shrink, correctly.

## Building power outages

Severe storms fault individual junction boxes (building feeds, not the hardened central plant), so the server has always produced per-building blackouts. `pw` reached the client and traffic signals read it (streetlights read `sl`), but buildings ignored it and kept windows, neon, blades, blooms and rooftop ads lit.

### The wire

`pw` is 1 powered, 2 browning out, 0 dark, with `em` and `og` qualifying 0. `overloaded` used to collapse into 0, which was wrong: `applyPowerLightEffects` keeps cheap fixtures on in a brownout, sheds expensive ones and holds streetlights up as infrastructure, so a browning-out junction went dark in the windscreen while the room said lights were flickering. `pw === 0` keeps its old meaning, so the signal test needed no change.

`og` exempts whole regions. Deadwater is dark by construction (4,836 orphan `power_zones` rows, one per tile, no generator) and so is the Under, and every light there is flame, oil or carbide; treated as an outage it would black out the Null's powerhouse. `getZoneOnGrid` distinguishes a failed feed from a connection that never existed (identical to the sim, opposite from a cockpit). A dead generator (out of fuel, smashed, storm-faulted) still counts as a real blackout.

### Two renderer states

`POWER_DUTY` scales what a building emits; `POWER_WIN` says what the rooms behind the glass are doing and is baked into the wall texture, since lit windows are texture. Set only the first and a dark building keeps its lit windows (most of the bug); only the second and the neon stays on. Both are per-tile frame state armed by the world pass (the `ADORN_TIER` idiom) rather than an argument threaded through `drawTypeModel` → `drawTypeModelArm` → 170-odd cases that new arms would forget.

- Only the night bake varies (unpowered buildings look normal at noon), so the day texture is shared and the GL atlas stays one entry per palette.
- Trap: `flatWallCol` takes the variant too. It paints walls too small to blit a texture onto; without it a blacked-out tower is dark up close and lights up as you fly away.
- Scale once, where the alpha is owned. Guards in `glowPool`, `blinkLight`, `groundLamp` and `lightBeam` left 526 leaks on the first census, because `pushLight` has a dozen direct callers (a stack's ember, a steam plume lit from below, a rooftop helideck's perimeter ring). Emitters only switch off; dimming is one line in `pushLight`, since otherwise `lightBeam` → `glowPool` → `pushLight` applies it three times.
- The gate mustn't go in `pushStroke`, which carries structure too: masts, lattice legs and catwalk rails would vanish with the neon (1,859 structural strokes stand in a blackout, and the gate asserts it).
- A dead sign is a painted board, never deleted (the streetlight's rule): `neonBlade`, `marqueeBand` and `bakeSignText` take `powerNight`, which is idempotent rather than a factor so a chain of calls can't halve it repeatedly.
- The 2-D painter needs `POWER_NB`. A dark building's arm runs at `night: 0` (the only way to reach the lit-trim decisions 170 arms make privately), and `draw3DBoxAt` derives its texture blend from that argument, so without `POWER_NB` the wall gets the day texture, paler than the lit buildings beside it.
- GLASS 2 gets the light half free and needs an atlas variant per dark palette, never for roofs (no windows, and doubling roof entries on a page with a hard device ceiling drops the city to flat colours). The mesh is memoised per model and shared by tiles, so the group may disagree with the frame about `nb`: the variant rides the group and `rectOf` takes it.
- `windowKey` includes grid state (its only term that isn't a property of the building); without it the blackout appears only at the next buffer rebuild.

### Gate and measurement

`npm run gl:power` ([scripts/shapes/power.mjs](../../scripts/shapes/power.mjs), in the `pretest:regress` chain and in `shapes:smoke`, per the two-lists warning): 61 claims over 267 models, mutation-tested 13 of 13. It reads the GLASS 2 hop chain from source with comments blanked first; two mutants survived a raw scan because the gate's own comments named the identifiers.

The picture is `__glPower()` / `__powerShot()` in the Modelshop (no harness reaches a GL draw call). Cab seat, 640×360, 23:00, 9,312 wall pixels: control 0%, brownout 8.0%, dark 21.6%, emergency 25.3%, off-grid 0% (the exemption), emergency vs dark 10.2% at worst 37. At 13:00 every state matches the control, by design.

- The emergency circuit first used an occupancy of 0.06, which came out one pane per facade, so `dark` and `emergency` both read 90.8% / worst 60. More scattered rooms would read as a brownout, so it's a column instead: the stair lit at every landing.
- Named models paint their own facades and never reach the shared biome wall texture holding the window grid, so a scene of only named models read the pair byte-identical. The scene now includes plain `bt` buildings; the named ones are still the only ones with neon, blades and lettering.
- Compare the emergency pair with each other, never with the lit street, or both land on the same figure to a tenth of a per cent.

Traps:

- `wallTex`'s bake closure binds `w` to the palette RGB three hundred lines up, so a mode read through that name compares an array to a small integer, every branch takes the ordinary arm, and a blackout bakes a fully lit facade while every counter reports success.
- `type:noodle_bar` emits 0 strokes on its first run and 4 thereafter (a cold shape/kit cache), so comparing a model's first two runs measures the cache.

## Point lights on walls

The same list the sprite layer draws is fed to the mass shader as point lights (`RENDER_TUNE.glLights`, 0 turns it off), so a neon sign washes the facade it's bolted to. Nothing new is authored or collected. The term is added after the key shading, so a frame with no lights is unchanged.

- **Reach comes from brightness, not bloom size.** A sprite's radius is `clamp(k / f, lo, hi)`, a clamped screen size chosen so a halo looks right. Converting it back through the projection gave every sign about half a tile of reach and moved 0 pixels on a building lit by two neon signs.
- **The diffuse term is wrapped.** The commonest light is mounted flush on its wall, so the wall-to-light direction is nearly perpendicular to the normal and a pure cosine is ~0: straight Lambert moved 0.4% of wall pixels in a dense night frame, wrap 0.5 moved 1.7%. `wrap` then came down 0.6 → 0.35 because a wrapped diffuse lights faces turned away from the light, so an external camera sees walls glowing from a source round the other side (reported as "influenced by the external camera view at certain angles"). At a fixed gain, wrap 0 costs the cab 4.2 points of coverage and the air seat 7.4.
- **It's scaled by the night**, because signage is drawn by day too: without that, a shopfront showed a pink cast over 19,000 pixels of its own wall at noon.
- `__glLights()` in the Modelshop measures it: 16.9% of wall pixels moved on a dense night cab frame, 12.8% from the air, 0.3% by day, cost inside this machine's noise.
- **Solids lift, they never add.** `gl/solids.js` (your aircraft, parked aircraft, the depot shed, the lock) takes the same list through `lamp` and `rl`, and uses the wall lift's rule: the lamps lift the night-dimmed colour back toward the undimmed one, tinted by the lamp and capped at 1. Until 2026-10-04 it added each lamp's colour, with no albedo and no ceiling. A lamp reaches about three tiles and an aircraft is a tenth of one, so every lamp in range lights the whole hull at once; the half-dozen runway and taxiway lights round a parked helicopter at Coldwater Regional took it past white and into the bloom (13,838 near-white pixels in one frame, 69 after). No gate covers it, because headless gates never draw. Check it with `__street` from an external seat at 23:00, with `LIGHT_TUNE.rise`/`fall` at 0 if the clock is frozen, or no light reaches its slot.

### Gain history

- Until 2026-09-11 that row read 43 / 23.5 / 0. The gain was cut 1.5 → 0.45 because the wash drowned the buildings. The harness had reported 0.0% at every sweep setting since `fadeLights` shipped. The gain went to 0.70 on the sweep's knee and back to 0.45 by eye in the game: `litPct` and `worst` measure distance from saturating a wall, and the complaint ("the wash effect is too dramatic") was that it read as a light show, which no column measures.
- A sweep row named as a multiple and written as an absolute goes out of date silently: `gain x1.5` held a literal 2.25. Gain rows are named by value now.
- 2026-09-12, 0.45 → 0.18: the wash is additive per light with no ceiling, and the city kept gaining emissive surfaces (neon tone pass, window ribbons, roof armatures, corner blades, lamp posts, 84 lettered signboards), so an unchanged gain grows brighter as frontage gets denser. Four of the twelve slots can land within half a tile on one facade. Flattening starts between 0.20 and 0.30.
- The same change split `wet` out of `gain`, because `rgbRaw` (what a wet road reflects) was scaled by the same knob and cutting the wall wash would have dimmed rainy-street reflections to 40%. `wet` keeps 0.45. Sweep rows now bracket the shipping value on both sides.

### Reach (2026-09-17)

Reported as "can we make signs have a bloom and that be the wash light instead of it affecting an entire building". In city units a storey is `FLOOR_Z × bldgH × bldgStretch` ≈ 0.196 tiles, a building 0.76 tiles wide, and an ordinary neon reached `minR + span·√I` ≈ 3.06 tiles: fifteen storeys up and four buildings across. The earlier cuts were the gain being turned down to compensate for a block-sized light. The wall now takes a share of the reach (`wallR` 0.32, about a tile) with a falloff exponent (`focus` 3; 2 is the term that shipped), and the gain is 2.5.

- Trap: `r` has three readers: this wash, and the wet road in both `ground.js` and `floor.js`, where it's the length of a neon streak and was swept at those numbers. `minR`/`span` keep their values, the road reads `r`, the wall reads a new `rw`.
- `washK` exists because a lit facade is an area source: `facadeGlow` tags its lights `wash`, and tightening them would have deleted `glWash`. They keep their own share, with `washK × gain` pinned to the 0.18 they were tuned at. Move one and you must move the other.
- 0.18 → 2.5 isn't a typo. A first try at 0.55 measured as 6% of the light the wash had been laying down, because a gain only means something against the area it's spread over. The shipping row was swept over wallR × focus × gain against the old wash: area 0.31×, peak 1.56×, energy 0.34×, zero pixels blown to white. The last column is the limit: every row above gain 2.5 at this reach starts whitening the middle of the pool, and a pink sign has to lay pink on its wall.
- `glHdr` stops a hot core clipping, but the tonemap still has to bring it back, and a core that arrives desaturated stays that way.
- Trap: `__glLights()`'s cab seat reads 0.0% for this. Measure `gain: 0` against the setting under test. Toggling `RENDER_TUNE.glLights` runs `g.litW.clear()` and restarts every light at weight 0 under a frozen clock, which looks like the feature being off (same class as the `settleFade` bug).

## Materials

`RENDER_TUNE.glMat` (0 puts the city on one BRDF); `glBump` is the relief half. Sixteen material families already decided what a wall looks like; none decided how it responds to light: brick, copper, glass and timber all used one half-Lambert key and two overlay tints, which is why metal never read as metal. Metal is view dependence (a reflection in its own hue), wood is its absence, frost is it blurred; none is expressible as albedo, and the fragment shader had no eye position. It has one now (`eyePos` in camera.js, solved for the point `viewMatrix` sends to the origin, asserted by `gl:parity` at 972 cameras including under pitch) and a five-column table per family, authored in windshield.js beside the painters.

The plan for linear colour, a GGX highlight, a prefiltered environment and per-texel material data is [glass-materials.md](../proposals/glass-materials.md).

### The material page (`RENDER_TUNE.glMatPage`)

Off by default. On, the atlas gets a twin page at the same rects (unit 4): r glass coverage, g lit coverage, b 1 + the family of the tile's non-glass texels, with b = 0 meaning the page says nothing. The six skins with windows have a page (102 palettes: the default facade, the shopfront, curtain glass, the Spire, the Meridian, the pump); everything else falls back to its face's family and the brightness guess in the night dim. Four traps:

- The page and the albedo share each skin's layout and lit test (`paneLit`, `curtainGrid`, `spireLayout` and the rest beside `wallTex`). Don't write a second loop: a page one texel off shades a stripe of wall as glass.
- b is constant across a tile. The page is minified with LINEAR filtering, and a blend of two family indices is a third, unrelated family. Glass is r, mixed by the shader; never a second family in b.
- b is an index, so the dusk page is painted with g scaled, never blended on a canvas, which could round b.
- Unit 4 is bound on every draw, to the page or to null. A sampler reads whatever its unit holds, branch or no branch, and a render target left there is a dropped draw (see "A pass that didn't draw").

### Linear light (`RENDER_TUNE.glLinear`)

Off by default; 1 makes the float target linear, 2 also lights the city's own shader in linear (gl/colour.js, and stage 2 of [glass-materials.md](../proposals/glass-materials.md)). Traps:

- Only the float target is ever linear. Eight bits of linear light band in the darks, so the mirror buffer, the room drawn alone, the sky pass and every 8-bit intermediate keep display values. A new pass that binds its own target sets `LIN.out` for it.
- A new fragment shader that draws into the float target goes through `linearOut` and calls `applyLinOut` after `useProgram`, or at level 1 it is the one layer still blending in display values.
- A factor tuned on display values is not the same factor in linear light. A darkening multiplier k becomes about k^2.2 (`lf` in the city shader). A mix toward a colour has no linear twin, so at level 2 the overlays, the lamp lift and the fog encode, mix as before and decode. The bloom and the composite curve encode first at any linear level. A new term tuned by eye needs the same treatment, or level 2 drifts from level 0 again.
- Additive halos can't be matched one layer at a time: in linear light the same addition lifts a dark pixel more than a bright one, and a shader can't see what is behind it. Their lighter edges at linear levels are accepted (2026-10-04), so don't "fix" them with a per-layer decode.

### Sky reflections and the GGX highlight (`RENDER_TUNE.glEnvCube`, `glGGX`)

Off by default. `glEnvCube` reflects a cube of the sky (gl/envcube.js) instead of the two-colour gradient, blurred by roughness; `glGGX` swaps the Phong highlight for a GGX lobe with the same peak. Traps:

- The sky has one definition, `SKY_DIR_GLSL` in gl/sky.js, used by the sky pass and the cube. Change the sky there, or the glass reflects a different sky from the one above it.
- The one deliberate difference is the glow right round the sun. The sky pass passes `SUN_LOBE_SKY` (about 2° to half strength) and the cube `SUN_LOBE_CUBE` (about 6°), because at 32 texels a face the cube can't hold a 2° lobe without it flickering between texels. The old 6° lobe in the sky clipped to a white disc twenty times the sun's size.
- Unit 5 is a cube unit, bound on every draw to the cube or to null. Pointing a 2-D sampler at unit 5 in the city's program is a draw error.
- The cube rebuilds only when its rounded inputs change (`keyOf` in envcube.js). A new input to the sky needs adding to the key, or the reflection keeps the old sky.
- Its levels are a box filter, fine for a smooth sky. Anything sharp moved into the cube (the skyline) would want a per-level blur.

### The surface page (`RENDER_TUNE.glSurfPage`)

Off by default. A third atlas page (unit 6): r height, g a roughness scale, b = 255 where it speaks. Every wall and roof surface has one (`wallSurf`, `roofSurf`) except the four speckled facades with no `FACADE_MAT` entry; the relief reads height there instead of brightness. Traps:

- A painter and its height twin share their geometry through the generators above `matGrain` (materials) and above `wallTex` (skins and roofs). Change where a joint falls there, not in the painter, or the relief embosses the brick and leaves the mortar flat.
- A new painter or skin needs a twin in `surfOf` or `SURF_TWIN`. `wallTexSmoke` fails a surface without one; without that check it would quietly read brightness again.
- A stain (lichen, rust, verdigris, moss) goes down with `surfRougher`, which adds to g alone. Painted with `surfPut`, it would overwrite the height and fill the joints under it.
- A roof page is per kind of deck, not per palette. A deck that starts reading its palette for geometry needs its own key.
- Height is per palette and resolution, never per hour or grid state. Don't key `wallSurf` on the dusk step.
- Magnified LINEAR, unlike the atlas and the material page. Height is a field; NEAREST makes every joint a cliff.
- `glHeightGain` (0.33) converts height to the relief's units. A new twin with bigger height steps reads as deeper relief at the same gain.


- **The family is derived.** Palette keys already resolve to a family through `wallMaterialOf`, so 284 keys and 8,223 mass faces over 173 models got a response with no content change. The index is resolved once per model beside `texKey`, never per vertex.
- Trap: an index out of range is undefined behaviour in GLSL ES. On this driver it reads zeros, gloss 0 gives `pow(x, 0.0)` = 1.0, a full mirror, with nothing logged. `npm run gl:mat` is the only check for this (`gl:mesh` compares geometry, `gl:glsl` names; both pass with every building pointing at family 41).
- **The environment comes off the reflected ray, never the normal.** Every facade is vertical, so a blend off `n` is one flat tint. The reflection gives sky at a tower's foot and ground at its top, which is what stopped the Solenne being a pale wash.
- **A specular lobe on a flat box just lightens the wall**, since each face has one normal. At `(0.35 + 0.65·metal)` a cab frame moved 23.7% of wall pixels and The Forge came back uniformly brighter. At `(0.15 + 0.30·metal)` it's 8.4%; the relief, which varies per texel, carries the material read.
- **Relief must happen before the key term.** It recovers a normal map from the albedo's luminance gradient (no second atlas page, no painter changed). First written inside the material block, it perturbed a normal `lit` had already used, so it reached reflection and specular but not diffuse, where mortar joints and plate laps show (25.2% without, 24.1% with: inside the noise).
- **Measure a term against the frame it's added to.** Relief brightens and darkens, so against the no-material frame some touched pixels land back near baseline and the count drops while the picture changes. `__glMaterials()` carries a second baseline.
- Measured: 8.4% of wall pixels at a noon cab, 14.5% from the air, 0.3% at night; relief 0.3% / 2.0% (mean 11.5, worst 79 of 255 on joints, laps and rivet lines); off-building 0.00–0.01%; cost inside the run-to-run spread at every seat.
- It's a daylight feature by arithmetic: at night both ends of the environment gradient are night sky and the sun highlight is gone. Neon deliberately doesn't light it; the wall wash is diffuse-only by a decision recorded in the shader.
- **Frosted glass is a material row, not a grab pass.** Every glazed surface is an opaque skin over a solid box, so there's nothing behind it to refract, and the GL buffer holds no sky (still painted in 2-D). Frost from outside is a wide exponent beside a big sheen. Its one home was `ty_clone_vat`, moved out of `PLATE_WALL`: its own palette comment calls it "dark glowing vat glass" and it was painted as riveted steel.

### Chrome and frost families

`ty_hf_chrome` and its neighbours sat in `PLAIN_WALL` (seamless clad panel, flat fill), whose BRDF row is `metal: 0.00` with no environment term, so they read as pale render at any RGB. `CHROME_WALL` is new, and `FROST_WALL` went from one key to three.

- `matChrome` paints the reflected world into the albedo: sky above, ground below, a hard dark horizon line. A lobe can't say that (a texture has no eye), so `gl/context.js` puts the sun on top.
- It tiles, which is how a mirrored curtain wall looks: each panel holds its own copy of the skyline and the joints stop the repeat reading as banding.
- Its `bump` is near zero for `lattice`'s reason: relief reads the albedo gradient as geometry, and the biggest gradient here is the horizon, which would emboss a ridge across every panel.
- A new family rather than retuning `PLAIN_WALL`, which carries 40 keys (soffits, painted kerbs, kiosk flanks, lighthouse shells, crane bodies); `metal: 0.88` there would chrome every kerb in Coldwater.
- Trap: `MAT_ORDER` is appended only. The index rides in the vertex buffer, so an insertion renumbers the city (19 → 20, against a shader array of 24).
- Trap: a drum in a frost (or any `DRUM_MAT`) palette can't glow after dark. It takes the family's texture on the GPU, and a textured face ignores the night capture's colour, so it keeps its day look at midnight. The clone facility's vats (2026-10) use a plain key, `ty_clone_wall`, with a `litStyle(..., 'frost')` style: lit as frost by day, and a bright night albedo above the night-dim cutoff, so they glow.
- `FROST_WALL` had held one key, making it a coolant tank rather than a material; etched glass is what a nightclub's dance hall and a couture vitrine are lit through.

## Sky beam

`skyBeam` is the twelfth authored adornment: a sweeping shaft leaving a building, which a destination club has instead of a bigger sign, visible from across the basin.

- It uses `lightBeam`. The first version was a stroke, which has a world length and a screen-pixel width, so it's the same thickness from the next street and ten tiles up (reported as "make sure voltage spotlights aren't just lines"). A cone is a line of glows whose radius grows along it, widths in tiles, drawn additively and depth-tested by the sprite layer, so the club's own drum cuts the beam per pixel. No new primitive was needed.
- It's the lighthouse beam at a third of the width (the beacon starts 0.31 tiles across and opens to 1.36 over a 6.6-tile throw).
- Its duty is 1, the only motion cycle that never parks: a searchlight stopped for twenty seconds reads as broken. `RENDER_TUNE.motion` 0 pins it at its home bearing.
- It's night-only, so `moving.mjs` (which runs at `night: 0`) needs the per-entry `AT_NIGHT` exception or it measures one pose. Both halves are mutation-tested (a beam that doesn't sweep, a beam that ignores the flag).
- It starts outside its own lamp: a node rooted on the deck is half inside real geometry and the depth buffer hides that half.
- **A sprite can declare itself a moving part** (`pushLight`'s `tag`). `moving.mjs` hashed `canvasResidue`'s default return, which is counts; cranes passed only because backface culling changes their quad count as they slew, and a beam's node count is constant, so the gate saw one pose. The digest now hashes positions, and only of parts carrying `MOTION_TAG`, since smoke, arcs, vats and beacons run on other clocks and would read as never parking.

## Trade words on signs

`$trade` is `$name`'s sibling. `SIGN_HANZI` and `SIGN_WORD` held the trade vocabulary (夜總會 for a nightclub, 時裝 for couture) since the derived blade shipped, but authored models couldn't reach it, so both rebuilds below put the name on two fittings. `SIGN_WORD`'s header rule: streets read because signs say different things; three boards repeating CASH & CARRION look worse than one.

- The font picks the language: `hanzi` gets the Chinese word, anything else the English, so they can't disagree.
- `$name` varies per tile and can't be captured into a per-model mesh (`perTile` guards all three call sites); a trade word belongs to the model and captures like any authored string.
- `atelier` was in neither table (`boutique` was; same trade), so that blade resolved to an empty string and wasn't drawn, silently.

## Voltage and Aurelia rebuild (2026-09-20)

Reported as "weak overall, and the sign is hidden behind stuff". Aurelia's name band sat at z 0.093 with a canopy at 0.12 reaching 0.105 out over it and a glazed bay spanning 0.018–0.108, so the band was behind both. The painter sorted it forward; a depth buffer hides it. `sign:stand` and `signband.mjs` gate this. Four silent traps:

- A `bladePanel` on a drum is mounted on nothing. `anchored.mjs` reads box faces only, correctly, since a flat slab on a cylinder touches it at one line. Voltage's vertical name got a real sign pylon.
- A flank part's `cy` is the mass half-width. Both models used ±0.36 while the boxes are offset in `cx`, so one pilaster rank was buried 0.07 inside its wall and the other floated 0.03 off. The buried one hid the wall from the kit's `paintFree`, which put a gable-end advertisement through the fins.
- A second fitting takes the trade word, not the name again (both shipped saying it twice).
- A `marqueeBand` mounts at `cy + half·0.94`, pushing out along the entrance normal, so the authored `cy` is the remainder; including the wall plane double-counts it. That's the floating-sign bug `anchored.mjs` was written for.

## Snow on the ground

`RENDER_TUNE.glSnow` (0 is the renderer as shipped); `snowForce` is the bench seam. The server has long had `snow` and `blizzard` in `WEATHER_TYPES`, `currentPrecip` is three words wide, and rain below 1°C falls as snow; the client drew flakes but nothing landed.

- It costs nothing to collect: `WET_NOW` already refuses snow ("a snowy road that mirrored the neon would read as ice"), so the sample was taken and classified with an empty else branch. This fills it. No new packet or authored field; the wet road is untouched.
- Trap (fixed 2026-09-19): that split was written as two independent expressions, each ORing the headline word with a cell test, and both headline terms ignored the cell overhead, while `drawWeather` lets a local cell override the headline. A snow headline with a rain cell overhead drew rain, wet the road and deepened snow at once. (The report "puddles gather on grass" was lying snow: `pud` is gated `vRoad > 0.5` and the floor has no puddle term.)
- Rain didn't melt snow: `SNOW_THAW_S` was the only melt, so a downpour left it white for seven minutes. Classification, the four time constants and the melt now live in [client/shared/ground-accum.js](../../client/shared/ground-accum.js), which `drawWeather` also reads for its snow/rain split and the server integrates too.
- **A new client is handed the ground** (`sky.ground` → `wxGround`). All three quantities used to start at zero on page load, so a player logging in mid-blizzard stood on bare grass until the next thaw. `groundAccum()` in environment.js runs the same step off the day's precipitation and ships it with the sky.
  - Lazy, not a tick: a base plus a timestamp, advanced at `setCurrentPrecip`, so each integrated stretch is one constant rate.
  - Exact steps, not Euler (`P += dt·(a − P/τ)` drifts a few per cent), so one 30-minute step and 100,000 16 ms steps agree.
  - Seed, never re-seat: the renderer refines by the cell overhead, so adopting the server figure every push would drag a pilot in a rain cell back to the global answer four times a second. A reservoir forgets its initial condition, so once is enough.
  - RAM only; a restart takes the ground back to dry.
  - Eight hand-offs across four view files plus the server; a missed one is a seat that always starts bare. `gl:snow` pairs every `wxField:` in those files with a `wxGround:`; all seven mutants are caught.
- It's an accumulation, not a film, so it isn't another reading of `uWet`: the linear reservoir `POND_NOW` uses with a longer thaw (`SNOW_LIE_S` 120, `SNOW_THAW_S` 420; the ratio is the level a sustained fall settles at). Driven off live precip the world would go back to summer when a cell passed.
- **Three shaders.** The floor takes open terrain, the ground pass the streets, the mass every up-facing surface. `GROUND_FULL` paints road and pavement as opaque quads over the floor, so snow in the floor alone would be hidden on streets (the same constraint `uWet` records).
- **The floor buries the material and keeps the landform:** `tex` already has the hillshade folded in, so it mixes toward `shadeW`, not 1.0 (which gives a flat white sheet).
- **The street reads the drainage model the other way up.** Where water collects (gutter, ruts), snow is scoured: wheel tracks bare, kerb line banked, from `vLat`/`vKerb` with no new attribute.
  - Trap: `vKerb` 0 (junction, apron, forecourt, depot hardstand: no camber) splits on `vRoad` for snow, because a junction is the busiest carriageway and a yard isn't trafficked. Keyed on the kerb alone, every crossroads held full cover between ploughed streets (Marrow Street, tiles `nsw` and `nes`).
  - A flat scour term deleted the effect: `clamp(rut * 0.85 + 0.30)` left the whole travelled way at 0–0.30 cover because `rut` (two Gaussians) is ~0.04 at a lane edge and ~0.47 between tracks. The Gaussians alone give dark tracks with white between.
- **The mass uses `n0`, never `n`.** `n` includes recovered relief and the bevel, so snow would sit in mortar joints and every chamfer would grow a white line (the shadow bias's reason too).
- **The pitch a surface will hold rises with depth:** a dusting sits only on dead-flat surfaces, pitched roofs take a real fall. A fixed threshold whitens every roof at once.
- **Albedo is substituted before shading** (three lines): snow then gets the overlays, sun shadow, chamfer, both occlusion terms, the screen-space pass and the point lights. Mixed at the end it's a flat white decal.
- **Snow takes the night in all three passes** (fixed 2026-10-05, reported as "entire stretches of road wash out in bright colour" on a rainy night). The road pass mixed a constant 0.9 white in after `uNightDim`, so lying snow was about nine times the tarmac at midnight and the whole carriageway read as a lit sheet, with the verge (floor, dimmed correctly) a dark strip along the building bases. It now takes `uSnowCol`, which is `SNOW_COL` from windshield.js (the floor's own expression, dimmed by `moonNightDim`), hazed by `gfog`. The mass had the same fault one step removed: a 0.9 albedo is over the night dim's 0.55 lit-window guess, so every snowy roof and awning skipped the dim. `litK *= 1.0 - snowW` keeps snow out of it.
  - Trap: snow on the ground in rain is legitimate. The server seeds `wxGround` from the global precipitation word, which is 'snow' at or below 1 °C, so a page loaded after a cold spell starts under snow even under a rain cell, and it takes minutes to thaw. A washed-out road at night is worth a `__wsTune.glSnow = 0` before anything about lights.
- **The antialias band needs a cap as well as the puddle shader's floor.** The floor stops a world-space threshold crawling; the cap is because at the far end of a road one pixel spans several tiles, `fwidth` exceeds the field width, and the edge becomes a ramp that reads as fog.
- Measured in the Modelshop, pinned clock: 10.4% of the frame at a dusting, 55.6% at half, 85.7% at a full fall, control 0.1%.
- **No headless gate sees the picture** (every harness's GL hook returns a bare canvas). `npm run gl:snow` ([scripts/shapes/snow.mjs](../../scripts/shapes/snow.mjs), in the push chain and `shapes:smoke`) asserts: snow/rain classified the right way and thawing rather than switching off; both ground layers write `uSnow` every frame (a uniform keeps its last value, so setting it only when snowing leaves the world white after one blizzard); world.js hands depth to all three consumers. That last check locates each hand-off rather than counting (there are three; "at least two" survived deleting one). Mutation-tested 7 of 7.

### Wheel tracks

`RENDER_TUNE.glTracks` (0 is the snow as it lies). Cover is per fragment from world position, so tracks need memory; the store in windshield.js is the only stateful part of the feature.

- **Other players' tracks need no server state.** `airContact` already sends a stable id, a sub-tile float position and `onGround` to every pilot within `CONTACT_RANGE` at the mover's sync cadence ("for client-side dead-reckoning between relays"); trucks come through the `vehicle.contacts` gather hook. Tracks are derived from that; no packet grew.
- **Velocity comes from successive positions, never `ias`:** `airContact` sends knots off `cont.airspeed`, `truckContactsNear` mph off `rig.speed`, unlabelled. A point is dropped once the source has moved far enough.
- One array of points, not segments: n vec4s carry n−1 segments with a spare component per point for the burial, and the run-break flag rides in it too. A segment list would need a second array.
- One distance, two wheels: perpendicular distance to the centreline, marks at `abs(d - half)`.
- **The gauge is the rig's own lifter stations.** It was 0.16 and 0.032 tiles, from metric (a tile ~7 m, axle 2.5 m), which is five times too big because vehicles aren't drawn at metric size: a truck is `CONTACT_SIZE.truck × ownExtMul`, 0.063 tiles across the cab. Tracks ran a truck's width clear on each side ("far wide outside of the truck body entirely"). `podGlow` publishes each lifter's position and now width, and `SZ` is the expression `drawHeadlightBeam` scales a lamp station by, so a wider truck's tracks move outboard. Measured: half 0.0321 tiles against a cab half-width of 0.0315.
- One gauge in the uniform, the nearest run's (`near` is sorted); between two trucks the error is a quarter of a lifter's width.
- **Distance to the line, not to the segment.** `abs(d - half)` over a capsule distance is an annulus, so each segment wrapped arcs round its ends and consecutive segments closed a full circle at every point, 0.32 tiles across, one per `TRACK_STEP` ("circles in the middle from straight driving"). Now `t` is unclamped and the end cut square.
  - The square end is mitred only where the run continues; a butt cap leaves a wedge `half * tan(half the turn)` long on the outside of each bend. True run ends (head, tail, either side of a relay gap) have nothing to mitre into.
  - The longitudinal feather is for run ends only; `fp` is most of a segment at the far end of a street, so feathering every joint puts a grey dot at every point.
- **The last point is provisional** and follows the wheels every frame. Points were kept only after moving `TRACK_STEP`, so the path lagged half a tile and grew in jumps ("big chunks"). The head is committed when far enough from the point behind it, so stored cadence is unchanged.
- **A bend commits early:** also once the run has turned more than `TRACK_TURN` since the last point. Free on a straight; eleven points round a right angle (a 90° bend went from ~25° kinks to 8.0°; "tracks also have to smoothly turn"). `TRACK_CREEP` is a required minimum spacing, or a rig shuffling on the spot fills the buffer inside one lifter's width.
- **The cut is total.** It stopped at 0.88, leaving a grey smear; a tyre removes the snow, so the fragment falls back to the real road (palette, wetness, standing water, light).
- **Burial is by what falls after, plus wind with age.** Each point stamps how much had fallen and when. Trap: it's the fall, not the depth. `depth - laid` failed because `SNOW_NOW` is a reservoir that settles at `SNOW_LIE_S`/`SNOW_THAW_S` in a couple of minutes, so ruts never filled during heavy snow. `SNOW_FELL` is the inflow alone, never reduced: a clear night buries nothing, a heavy fall fills a rut in about a minute (`TRACK_BURY × SNOW_LIE_S`; the old 0.13 would be sixteen seconds). The age term stops a session collecting invisible scars. Buried points leave oldest first (`trackFill` only rises); the store is empty with no snow.
- **A jump breaks the run and keeps the point** (range exit/re-entry, respawn, relay gap). Joining draws a straight gouge; dropping the point loses the first point of every run.
- Gated in `gl:snow` (mutation-tested 3 of 3): the gauge moves with the rig (a continental and a scrapper differ, and each spacing-to-width ratio is its own model's); a bend costs more points than the same arc length straight, worst kink under 15°; 15 s of snow buries further than 15 s clear, with `snowForce` pinned both sides (otherwise a depth-keyed burial measures 0 in both).
- The mass pass gets no tracks (nothing drives on a roof); the gate asserts it. A rectangle reject before the loop bounds the cost, since 39 segments per fragment is far more than the wet reflections' six.
- It can't be a tracking mechanic: `CONTACT_RANGE` is 12 tiles, so you only record tracks of somebody already visible, and each client's set differs. Mostly you see your own: NPC traffic isn't in the contact feed and only `seat === 'pilot'` receives one.

## Trodden ground and ground grain (`RENDER_TUNE.glWear`, `glGrain`)

Both are on by default, and 0 gives the floor as it was. GLASS 2 only: they're uniforms on the floor shader, and the 2-D raster doesn't see them. Old Coldwater was the report: its lanes drew as flat desert tan and its yards as lawn, because `dirt` terrain is the `badlands` biome and a building tile is `citycore` turf.

**Where people walk (`glWear`).** `footfallFill` in windshield.js runs inside `groundLUT` and puts four numbers on each land tile's LUT entry, uploaded as the floor's fourth plane (`uLut3`): wear, path bits (N 1, E 2, S 4, W 8), litter, and how green the open country round the tile is. Nothing is authored; it reads the cells the window already has.

- A camp (`mark: 'camp'`) is fully worn. Bare ground (an `ARID_BIOMES` tile) is a lane when buildings and camps round it weigh in (`S >= 1` over a 5x5) and one stands, camps or runs as road right beside it. Otherwise the desert past a town's last house would turn to mud.
- Wear spreads one tile: a building whose yard meets a lane is 0.7, turf next to one gains 0.3, and turf in a dense block wears up to 0.3 on its own.
- Paths: a building's only path is out of its door (`ent`), and the tile its door faces gets the matching bit. Worn ground (0.3 and up) joins worn ground. A lane beside a street cuts through to it on a third of its edges (hashed off the world, so the choice stays put) and always once if it's a dead end.
- The Curtain (`cur`) is a wall: a Curtain tile carries no path and at most 0.35 wear, and ground beyond it gets no settlement credit through it. Bare ground touching water is a beach: no lane, at most 0.3 wear.
- In the shader, turf gives way to mud in patches as the wear rises (a level against a field, as the snow lies). Each path runs from a hub near the tile's middle to edge crossings hashed off the edge, so the two tiles either side agree. A straight run's hub sits on its line, or every tile kinks. Lanes worn past 0.75 carry two wheel ruts with banks; camps and yards don't. Then come puddles (more with `uMud`, the ground's pond level), boot-prints near to, fire pits on camp ground, and rubbish that drifts into heaps.
- Mud is wet in green country and dry in the desert, from the green vote, so a desert yard reads as dust. The tint toward the tile's own colour takes the smooth four-tap blend; the sharpened one put a tile-sized step in the mud.

**Less flat ground (`glGrain`).** The raster faded every land term on one distance ramp (`detail`, minimum at 1.4 tiles), because its chunky texels aliased early. `ldet(f, …)` fades a term of frequency `f` against the pixel's own ground footprint instead, so fine grain goes first and broad patches carry to the horizon. On top of that: a field-sized light/dark drift, straw and lush patches and a hue mottle in grass, damp and bleached patches in dry ground, shaded stones and clods, and land grit that's no longer held to the nearest rows.

- The new terms hash off the absolute world position (`gwx`), since `wx` hops a tile when the window recentres. The exception is the finest grit (over about 60 cycles a tile), which uses `wx`: at a world coordinate near 900 a float has no room for a lattice that fine, and grain hopping on a recentre can't be seen.
- No widths inside these branches use `fwidth`, because the branches aren't uniform. They use the footprint `fpx`, as `trackCut` does.

Gate: `npm run gl:footfall` ([scripts/shapes/footfall.mjs](../../scripts/shapes/footfall.mjs), in the push chain) runs the derivation on a synthetic window (camp, lane, doors, desert, beach, Curtain), checks the plane packs as the shader unpacks it, and checks that the floor writes `uWear`, `uGrain` and `uMud` every frame. It can't see the picture; look in the Modelshop with `__street`.

## Plinth and crown bands

`RENDER_TUNE.glCourse` (0 removes both bands and keeps the roof coping). `models:quality`'s worst score is "more than one wall palette", failed by 22 of 173 with 26 more at two mass segments or fewer. Voltage's authoring note names the fix ("the crown takes a different palette so the silhouette carries a light value"). `parapet` already draws a band and was only used at the roof edge, so a plinth at the pavement and a crown course a storey below the top needed no new kind, painter or schema change. Measured: 2.82% of pixels at night, 3.60% by day for +4.8% faces (the two rich-kit phases moved 0.5–2% each for +35%).

- The crown asks `wants('cope')`; the plinth doesn't. Same kind, but nobody hand-draws a base course and many hand-draw a cornice (gating on it is the `vent`-under-`wall` error).
- A band is square-only (`parapet` takes one half-width); 163 of 172 models have a square base, and the gate watches it because it could silently zero the feature.
- The first reach check couldn't fail: plinth, crown and coping are all `parapet`, so "has two" held for 118 models with the section deleted. The gate counts a band at z ≈ 0: 98 with, 0 without.
- The quality board can't score this (it counts mass palettes; banding is trim), so it still reads 151 of 173. Counting trim there would score "has any trim" twice.

### Bench clock trap

Benches pin `performance.now` so a drifting sky isn't read as a finding, but the light set fades over elapsed time, so under a stopped clock no light reaches its slot and `glLastFrame().lit` stays 0. `settleFade` in glbench.js fixes it and must run after the setting under test is applied. The day seat, which has no lights, is the control; an early cut reported lights costing 2.5 ms there because it measured off-then-on in fixed order and took the larger of each pair.

## Sign stand-off

`RENDER_TUNE.signStand` (0 puts every marquee back on its own half-width). `marqueeBand` pushed out along the entrance normal by `half * 0.94`, its own width, so a band narrower than its facade sat inside the building. The painter drew it anyway; the depth buffer shows only what crests the parapet ("legible signs not buried in the building").

- It had been fixed twice per arm by inflating `half` (`helpings` to `fh * 1.07`, `tine` to `WALL * 1.09`), both notes naming the coupling as the bug. There are 26 callers; `npm run sign:stand` ([scripts/shapes/signstand.mjs](../../scripts/shapes/signstand.mjs)) found 27 of 56 name bands behind their front wall, worst `type:comic_shop` by 0.282 tiles. Now 0, with 53 of 56 pushed to the wall.
- The mass is asked: `wallFaceAt` is the building's captured front plane over the band's z range. A constant (`fh * 1.0`) floats signs in front of set-back walls (podium, forecourt, recessed shopfront).
- It's a floor (`max`), so the two hand-fixed arms don't move.
- The stand-off is solved at the fitted band, not the caller's `wz`, since `marqueeSpan` may move the band to clear an awning or crown a parapet.
- The two numbers are recorded by the function that resolves them, because once the band is a quad they're one offset, and a gate re-deriving them would be a second opinion (`glresidue`'s lesson).

## Clear wall band for a name

`sign:stand` asks how far out a board stands and `sign:fit` whether a wire crosses one; this asks whether the facade band under it is free. Reported as "adequate logo floats ontop of windows and disappears": 68% of the board's height was inside the shopfront glazing band, 15% behind the canopy, 4% on clear wall.

- Behind the glass: `windowBay` glazing is at `faceY(cy) + FACE_EPS` and a `signBoard` at `faceY(cy)`, so an overlapping board is behind a near-opaque pane and coplanar with the window surround (a per-pixel depth tie). The painter drew the later quad, which is why this is new.
- A canopy reaches `out` beyond its mounting plane (0.105 tiles is typical), so a name inside the canopy's height is hidden from the street regardless of depth.
- Trap: z semantics differ by kind. `signBoard` and `windowBay` take `z` as a centre, `canopy` and `parapet` as a bottom; a window's surround is `hh + fr` tall; `neonRun`'s `drop` hangs a return at each end, not a curtain. Treating everything as `z ± hh` reported adequate's canopy at 31% (it's 15%), missed the glazing, and flagged a fixed board as under a tube it clears.
- The fix depends on reach: a part a few hundredths past the board means it's sunk, and raising `cy` stands it proud of the glass (nine boards over eight models); a canopy's ~0.1 tile means moving the name to the clear band above the deck.
- Gate: `node scripts/shapes/signband.mjs`, in `shapes:smoke` and the `pretest:regress` chain. Its `PINNED` map fails if a recorded share grows or stops matching, so fixing a pinned model means deleting its pin. Four low shops are pinned (glazed podium, full-width canopy, a parapet with a 0.013-tile gap); shrinking, standing off or moving the name is a Modelshop decision.

## Sign shape and camera

`RENDER_TUNE.signSquare` (0 restores the per-corner pull). Reported as "signage has a weird way of moving around when moving camera", and invisible to every gate because the sign is correct in every respect but shape. `cam.unproj(p, pull)` spends a stand-off as `f - pull`, scaling each corner toward the eye by `1 − pull/f`, and off-axis corners have different `f`, so a rectangle arrived as a parallelogram whose lean depends on the camera; `fitSignPts` then forced the texture aspect back, so the sign grew and shrank as you drove past. Measured: 84 of 354 signs out of square (worst 7.6°), 88 changing width by over 1% across a 40° swing (worst 8.2%), worst screen error 58 px.

- Lettering (`emitSurfaceText`) unprojects exactly (pull 0) and `standOffQuad` translates the finished quad along its own normal: rigid, camera-free, and clearing more at grazing angles where lettering z-fights worst. That's what `faceY` does and what `FACE_EPS` is named after.
- Boards, blades and panels (`emitDecoQuad`/`emitDecoFill`) can't: `BLADE_PROUD` is 0.25 tiles and exists to win a depth test without moving the artwork (blades are authored inside their facade). `unprojQuad` pulls every corner by the same fraction of its depth, a homothety about the eye: 0 of 2,148 quads move, worst 2e-13 px.
- `emitWire` still pulls per endpoint; a stroke's projection is preserved either way.
- Knock-on in a gate: `signfit`'s depth test had no tolerance, so a fitting flush to the fascia (0.005 tiles, under `FACE_EPS`) counted as a wire across the sign once lettering stopped leaning. `COPLANAR` is 0.02; the five real crossings are 0.2 tiles.
- Gate: `node scripts/shapes/signswim.mjs` (no npm name), in the push chain and `shapes:smoke`: lettering must be square, everything must keep its shape as the view turns. 264 findings at flag 0, 0 at 1.

## Graffiti hands

`bakeTagText` drew only a throw-up, so all paint in Coldwater was one style. No fonts are needed (none in the repo, no build step to ship one); `TAG_FONT`'s note says spray reads from the heavy round-joined outline, not the face. A hand is a recipe of passes:

- **handstyle:** one ink, one lean for the word, a tail thrown off the last letter and back under. Trap: the tail goes on first or it's a line ruled across the word.
- **stencil:** flat opaque fill, soft overspray, speckle, and bridges punched with `destination-out` so they take the overspray too (a bake doesn't know the wall colour, so a painted bridge would be a coloured bar).
- **roller:** two flat offset tones, no outline or drips, nap streaks, one dry end.
- **buff:** the city painting over, a ragged patch of municipal colour at alpha 0.87 so the ghost of the piece shows (at 1 it was invisible).

Rules:

- The aspect does half the placement for free: `fitSignPts` only takes less of a quad, so a roller baked 3:1 fills a wide band of its patch. `TAG_HAND_BAND` sets height: a blockbuster goes up the wall (a pole), a handstyle low (arm's reach). Kit tags now span z 0.010–1.076.
- The hand rides the variant already rolled, never a new roll, which would shift the stream and move every tag in the city.
- Per-letter colour runs force the throw-up (the silver scheme's consent rule): the player said what the letters are; other hands are one ink.
- Roller and buff are kit-only, being hard to read. A player's paint gains a hand and keeps its patch, since `tagPatch` solves for legible clear brick and a small handstyle would shrink their words.
- `__tagSheet()` lays out one row per hand. It used to lay out one per colour scheme, and since both come off `variant` that could silently show none of a hand.
- Known limit: the kit sizes a tag to the bare gap it finds, so most kit rollers are 0.04 tiles wide. Widening needs a change to what the kit calls a paintable gap.

## Throw-up spacing and letterforms

A throw-up advanced each letter 0.72 to 0.84 of its box so every letter bit into the one before it. On a four-letter handle that read as style; on a sentence a player sprayed it buried a third of each letter and COLDWATER LIES came out as a row of blobs.

- `tagLayout` spaces letters by their outlines. Each letter gives its body as line segments (a traced path, the offset edges of a stroke, or a box for a font letter), cut into 2px bands. Each band is grown by a disc of half `TAG_GAP` (`tagGrow`) and a letter moves left until its grown outline meets the grown outline of every earlier letter on the line. Spacing by bands alone left an A and a V with parallel diagonals under a pixel apart at right angles. Lines nest the same way by columns.
- The bake lays every keyline, then every fill. With the letters apart, the gap between two bodies is always keyline, so a piece has one outline round the outside and a single line between each pair. Drips start at the foot of the outline and go under the letters; they used to start inside the letter and draw a bar through it.
- Letterforms are `TAG_FACES` in `client/shared/tag-strokes.js`, shaped by `TAG_FACE_SPEC`. `bubble` is the traced sheet; `round`, `block` and `sharp` stroke one skeleton alphabet. A keyline is the same path stroked wider, so a mitred letter's keyline and block stay mitred.
- Stroke weight decides whether the counters survive. An E has three arms in one letter height, so above about 0.3 of the ink height the gaps close. The weights were set by rendering the whole alphabet per face and reading it back (`__tagSheet({ faces: true })`).
- The canvas offers a full mitre or a bevel and nothing between. At the sharp face's weight an N or W corner's full point is four half-strokes long, so corners are drawn bevelled and `tagJoinPoly` adds the point back, cut off at `clip` half-strokes. The cut moves out with the grow so the keyline runs round the end at its own width.
- A letter can carry an alternative under a face's name in `TAG_STROKES`. The upright faces use an arched A, since a pointed apex at their weight closes the counter and `sharp` keeps the point. `round` takes its G bar as a separate stroke, since smoothing curls a joined bar into a 6.
- `trace-sheet.cjs` gave the i's dot to the H beside it (the first letter it touched), so every H had a dot and every I was a stem. A small piece now joins the letter it overlaps most. Only H and I changed on re-tracing.
- The traced C is reshaped by hand in `tag-glyphs.js`: the B overlaps its back on the sheet, so the trace bit a hollow out of it, and its mouth traced as a deep cut with hairline slits that the keyline filled into black dots. A re-trace undoes it; keep that entry.
- `tagPreview` (the spray can) bakes with the cache off, since a draft per keystroke would evict the walls in the street.
- Gate: `node scripts/shapes/tagspace.mjs`, in the push chain and `shapes:smoke`. No two letters come closer than the gap, letters in a word touch, every A to Z and 0 to 9 has a drawn or stroked glyph in every face, and no point reaches past 0.8 of a cell. Distances are taken on the outlines by scanline and segment distance, never from the layout's own bands.

## Halcyon Fields tint (`RENDER_TUNE.hfTint`)

`hfTint` 0 puts the quarter back on one hue, byte for byte.

Halcyon Fields (the Glasshouse quarter) is 69 building tiles over thirteen silhouettes, reported from the air as having no glasshouse style. Two causes:

- **Palette.** Every building faces its mass in `PLAIN_WALL` keys (`ty_hf_chrome` [186,198,208], `ty_hf_ice` [218,230,238], `ty_hf_deck`, `ty_hf_slab`): flat fill, `metal: 0.00`, no environment term, no window grid. This is the trap `voltage.json` describes ("pale stone's opposite is not a mirror"). The `chrome`/`frost` families that fix it reached five authored models and no Halcyon tile.
- **Geometry.** 85.4% of the wall area is flat-shaded drum: 2,594 drum faces against 444 box faces over the 23 arms, with zero `windowBay` and zero `neonBlade` calls. `drawFacetDrum` never reaches `wallTex`, shades against a fixed key direction instead of the sun, and marks its faces `flat` so the GL material pass skips them. `derivedTrim` takes wall planes from unyawed boxes only, so a drum-mass building is invisible to the derived kit (five of the registry's ten untrimmed models are here).

The ramps were already varied: 133 calls over 69 distinct lo→hi pairs, all hand-picked. They read as one white material because all 69 are the same hue: 17–29% saturation at the dark end and 2–12% at the light end, and `hfChrome` raises the light dot to a power of 2 or more, so most of each drum sits at the light end where they converge. The variation was all in lightness.

So each tile takes one of eight casts off its own seed:

- A cast is a hue, authored as an angle in the YIQ chroma plane, so `dY` is zero at every amplitude however the table is retuned. That keeps the estate reading as one developer's cladding.
- The nudge scales with the facet's own luminance. A flat offset moves the dark end 19.0 and the lit end 13.7, the wrong way round.
- It's seeded, which is why GLASS 2 can have it: `meshParams` includes `it.seed`, so the mesh memo is per tile and the colour is captured correctly for every copy. A cast off the hour, camera or power state would be frozen at capture (the trap `POWER_NB` rides the group to avoid).
- Trap: hash the seed, never `seed % N`. The tile seed is linear in both coordinates, so a modulo walks the table in lockstep along a street and paints stripes, while passing every other check.
- `HF_AMP` was set against the picture. On a pinned-clock A/B (control 0.00%), 13 moves 7.5% of the frame at a mean of 3.4 levels and 20 moves 14.1% at 4.2. 13 is the bottom of what reads; at 20 two towers of the same type stop looking like the same building.
- Boxes aren't tinted: a palette key is an atlas entry, and a per-tile variant on `texKey` is what the power note forbids.

Trap: `__street` can't measure this. It freezes no clock by design, so the same setting rendered twice moves 49% of the frame. Pin `performance.now`, `Date.now`, `Math.random`, `resFloor` and `perfDS` and the control goes to 0.00%.

Gate: `npm run gl:hftint` ([scripts/shapes/hftint.mjs](../../scripts/shapes/hftint.mjs)), in the `pretest:regress` chain and in `shapes:smoke`. Mutation-tested 7 of 7.

- It finds the polished arms in the loaded tables under `glass/models/` and reads each arm function's own source. Before the arms moved out of windshield.js (2026-10-01) it swept the text instead, and had to bound itself to `drawTypeModelArm`: a sweep for `\n    case '…':` over the whole file collected other switches at the same indent, and the first run reported `skullbob` (a cab trinket) and failed it for not being tinted.
- Its leak check is a source check on purpose. All 152 `hfChrome`/`hfGlass` call sites are inside the building arms and `drawTypeModel` re-arms on entry, so deleting the `finally` restore is unobservable today. It guards a future nested arm.

## Lit drums (`RENDER_TUNE.glDrumLit`, 2026-09-27)

The mass shader's `aFlat` has a third value, 2: the face's own colour lit as a wall. It takes the key light, shadow, snow and the material block, but `texW` is 0 so the atlas never replaces the colour. `hfChrome`/`hfGlass` tag themselves (`litStyle`) with an albedo carrying the tile's cast and a family, and the drum mesh emits `flat: 2` with that family's `matId`.

Chrome drums take `tile`, because both reflective metal rows leave almost no diffuse and the spiral decks came out black with bright rims from the street. The derived kit already dresses a drum shaft (collars and a `drumfin` rank); it deliberately doesn't hang flat-wall parts on a cylinder.

## Pilaster ranks (removed)

The derived kit used to stand a rank of pale fins on about two thirds of the city: on the frontage between the glazing columns, and on the back wall and the service flank. `RENDER_TUNE.glPier` switched both. They were removed on 2026-10-02. The fins ran most of the height of the wall and stood proud of it, so they crossed whatever the building carried (Precinct 9's badge, painted works names, gable ads), and on most buildings they read as a row of columns bolted to a wall.

The `pilaster` part kind stays for models that author one: the Sentinel, Jolene's, Voltage, Aurelia, the Ascension Gate and a few more. What building the ranks taught still applies there:

- One part draws `n` fins (the `bollard` rule), so a rank costs one `KIT_MAX` slot.
- Give it a trim palette, not a shade of the wall. On this city's dark walls a shade is correct in the mesh and invisible on the building (see `feedback_detail_parts_need_own_palette`).
- Keep it off lettering. Stop the fins under the name, or put the name between them; a lit runner through a name is what `sign:fit` catches.

## Cloud deck on the depth buffer (`RENDER_TUNE.glClouds`)

`glClouds` 0 puts the 2-D deck back.

No test had ever run the clouds: `drawVolumetricClouds` returns immediately without `wxField`/`acX`/`acY`, and `viewRenderSmoke`, `framecost` and every Modelshop bench pass none. Every frame cost previously recorded was for a cloudless sky. `npm run shapes:clouds` measured the deck at 2,757–9,460 canvas calls a frame (median 5,386), against 17,400 for a whole city block.

On the GPU each card is a quad: 1,200–1,595 canvas calls saved and 0.5–1.0 ms on a 640×360 frame, and the deck matches the 2-D one to 0.09–0.23% mean colour. That figure is only meaningful beside an ablation, so `__glClouds()` renders a third frame with no deck: the deck is worth 2.9–10.4% of the frame.

- The pass clears colour but not depth. Cards test against the city the world pass just wrote, so a thirty-storey block can stand in a 1,600 ft overcast and the mass is never uploaded twice. Clearing depth too puts every cloud in front of every tower, which looks like the port did nothing.
- It's a second hook at a second moment. The deck collects after the world blit, so a sink the world pass reads would fill and never draw, silently (the Curtain's trap).
- The sort is kept: cards are translucent, so composite order changes colour; depth only decides what the deck is behind.
- Every card gets the full treatment. In 2-D a card wider than 26 px gets a sun-raked gradient and value-noise mottle and smaller ones blit one of twelve top-lit sprites; the fragment shader solves the two-circle cone per pixel and reads the curdle tile, so there's no tier. Same argument as the mesh capturing at `ADORN_NEAR`.

## Nothing in the cloud deck is cut (2026-10-02)

Reported as clouds popping in and out, with fake shadows under them. Every pop was a hard threshold somewhere in the deck, and every shadow was a dark shape drawn on open sky. The rule now: anything that enters or leaves the sky fades, and nothing dark is drawn outside a cloud's own outline.

- **Dark shapes, removed.** Each dome sprite had a "grounding shadow", a flat dark ellipse wider than the cloud and hung below it. Each near card puff had an occlusion pool: a near-black disc sorted behind the lobes. The lobes are nearly opaque at the core, so what showed of the pool was the part outside the puff. Both are gone; the base slab and base lobes (`CLOUD_CARDS`, `litBias` about 0.1) shade the underside from inside.
- **Dome sprites** fade in from 70 to 60 tiles and, with the deck live, fade out from 52 to 40. They were cut at 70 and at 44.
- **The volume** thins over the last 30% of its march (`uFar`), the same band the dome sprites fade in over. The march used to end in a wall at 48 tiles, about 9° above the horizon from under an overcast. Cells are taken by their near edge (`d - r`), not their centre.
- **Thermal caps** grow in from zero between 250 and 600 ft/min and fade over the last 8 tiles inside the edge of the columns the view collects. They arrived at 35% strength (floored to half by the card pass), and every tile crossed brought a ring of them in or out at 30 tiles.
- **The puff budget is a reach.** It was spent nearest cell first with a hard stop, so two caps swapping order at the end of the queue blinked, and `cloudQ` follows the live frame time, so the stop moved whenever a frame breathed. Now puffs fade over 6 tiles past `st.cloudReach`, which eases toward wherever this frame's budget ran out.
- **A cell's seed is its identity.** The server crops the cell list to the viewer and the seed was the list index, so a cell coming into range re-scattered every cell after it. It is a hash of radius, drift and strength, which are fixed for a cell's day. A packet also no longer re-seats a cell that is within a step of it: the server advects in 30 s steps and the client glides, so each `flight_ctx` hopped every cloud back by up to half a tile.
- **Volume and cards crossfade** over 0.8 s (`st.volMix`). The governor, the frame-time verdict and F9 each swapped them in one frame.
- **The frame-time probe keeps the volume.** It ran the cards for 1.5 s to compare, which under 30 fps meant a different set of clouds for a second and a half about once a minute. It now runs the volume at an eighth of the resolution and 16 steps, which draws the same clouds, softer.

Measured in the Modelshop by flying a free camera north at 1.5 tiles/s over open ground with the clock pinned, counting sky pixels that change by more than 24 levels between frames. Clear day (caps, one cell): the worst frame went from 7,741 to 1,161 pixels and frames over six times the median from 65 to 5. Cloudy: 1,209 to 1,127, all of it rain. Trap: `freeCam.x/y` is added to the craft, which already sits at `mapCenter + mapOffset`, so a harness passing the sub-tile offset to both moves the camera twice and reads every tile crossing as a pop.

## Flying things write depth (`RENDER_TUNE.glAirDepth`)

The **What flies in the depth buffer** slider; 0 puts both back.

Reported as clouds drawing in front of geese. A billboard is kept out of the depth buffer by `gl/billboards.js` so a bush can't punch its alpha-shaped hole in it. That's right for ground objects, but it leaves nothing for the one later pass (the cloud deck) to test against: at the birds' pixels the buffer held ground hundreds of tiles away, so the deck painted over the flock however low it flew.

- Air contacts took the same opt-in. `bakeContacts` pushed a bogey through the same funnel with no depth. The flag reaches that quad (asserted in the browser, `depth: true` on and `false` off) and the frame is pixel-identical either way; swept over three ranges and four altitude bands, no scene put the deck in front of a bogey. That path now only runs with `glShip` at 0: every contact is real triangles (`contactIsSolid`), so the card, its per-frame `texImage2D` and the 700 px guard (above which a close bogey painted over the composited city) are gone by default. The opt-in stays for the solids-off case.
- Ground billboards (trees, bushes, rocks, street actors) must not opt in: a cloud is never in front of them, so they'd pay the cost and get a hard-edged silhouette for nothing. With no billboard asking, the prepass doesn't run, which is why flag 0 is the shipped renderer.
- It's a separate depth-only prepass (`colorMask` off), not a raised alpha cutoff on the one draw. Discarding below 0.5 would delete every texel between the old 0.004 cutoff and 0.5 from the picture: a goose's antialiased rim, and on a contact the canopy glass, nav-lamp glow and exhaust. The colour pass is byte-for-byte unchanged.
- The quad's own alpha counts in the prepass only. A flock fading into haze is drawn partly transparent, and a 40%-present shape taking 100% of the cloud behind it is a bird-shaped hole in the deck, right where flocks spend most of their time.
- Trap: `depthFunc` matters in that file now. The prepass lays the quad's depth first, so under GL's default `LESS` the colour pass fails at every pixel and the bird vanishes. Every pass already sets `LEQUAL`; this one depends on it.

Checks: no headless harness reaches a draw call (they install a GL hook returning a bare canvas). `npm run gl:fauna` asserts the data (what flies asks, what walks doesn't, no other producer does, 0 removes it), each mutation-tested. `__glGooseSky()` in the Modelshop measures pixels. Over a whole flight at 640×360, the share of the flock's pixels readable under the deck went 74.7% → 84.3% in rain (worst frame 39% → 74%), within a point of that for cloudy, storm, snow, ash and dust, with 0 pixels outside the flock moved. The control is `clear` (deck at 7.5 tiles): 90.4% → 92.9%. What's left is the screen-space haze band and whiteout flood, which can't be depth-tested and are correct. GLASS 2 only: in 2-D the deck paints over the finished world.

## Baked billboards are for landmarks

`markBillboard` paints a 2-D adornment into a canvas and hands it to `gl/billboards.js` as a quad, re-baked at the live camera every frame (`fresh: true`) so it lands where the 2-D pass would. That's a canvas repaint plus a `texImage2D` per instance per frame: fine for the six marks it was written for (a statue, a gate, a sign, pylons, a bay, a no-fly tile), ruinous for masts, lattice towers and neon blades on ordinary buildings. Routing those through it for an afternoon measured a cockpit framerate below GLASS 1. Three of the six have since left it on GL: the statue and the bay are solids in `BAY_SINK`, and the pylons are `emitWire` strokes drawn during the sweep. The gate, sign, plaza and no-fly tile still bake, because their boxes only reach the per-model mesh capture and their lettering is raw canvas.

- Trap: never put `dx`/`dy` in a cache key. They're camera-relative, so all three callers minted a new key per frame: an unbounded canvas leak on the windshield side and a 256-entry GL texture cache turning over in seconds. `markBillboard` now prefixes `MARK_TILE`, so callers name only what varies within a tile.
- Trap: eviction. It took the oldest-inserted entry inside `textureFor`, and the oldest are the stable keys (a bush, a cactus, the gate) already queued in `batches`. `gl.deleteTexture` on one leaves a batch sampling a dead texture: a region's scatter turned bright pink and a gate drew as a hovering bush, only from an external camera with many masts in view. Eviction now runs once at the top of `upload` against this frame's keys and refuses to delete a live one, which turns a cache miss into a slow picture instead of a wrong one.
- `glLastFrame().bbTex` reports the cache size.

## Depot shed as geometry (`RENDER_TUNE.glBay`)

The **Depot in the depth buffer** slider; 0 puts it back on the canvas.

`gl/ownship.js` is now `gl/solids.js`: flat-shaded triangles that write depth and aren't culled. The rig was the first user; the depot shed is the second. The shed is the one building drawn at a fixed size by its own function, so it's in `MASS_EXCEPT`, never reached the GL mass, and was painted on the canvas after the city. `markHidden` answers whether the whole mark is covered; a shed is a tile wide and a third of a storey tall, so behind shops it's mostly hidden and never all hidden, and it drew whole. From the cab, a shed four tiles out behind a warehouse two tiles out: canvas drew 57% of a fully covered building, depth buffer 0%. With the wall a tile further back: 25% hidden against 85% (the rest is the ridge genuinely above the wall).

- It can't join the mass. The mass buffer is cached per map window; the shed's roller door opens as a truck approaches and its palette flips between interior and exterior reads depending on which side of the walls the eye is. Both are per-frame answers, so it would rebuild the window every frame.
- It's collected inline, before the hook. Other marks are `emitFace` closures run at flush, after the GPU pass, when every sink is null (the Curtain's trap).
- The sinks take the polygon whole. `drawVehicleBay` clips faces against its own near plane for 2-D; handing a pre-cut polygon to a depth buffer makes the shape depend on viewpoint (127 faces from the road, 40 from a quarter turn round).
- Trap: don't hand-wind a world-space quad. The name board went to the decal layer as four world corners in reading order. A `cull` decal is one-sided by NDC winding, and reading order in the shed's local frame survives rotation only up to a mirror, so the lettering was culled on the two `ent` facings where it faces you. `emitSurfaceText` takes screen points and recovers the quad through `cam.unproj`, which can't mirror.
- Lost: the 1px `stroke` outline, so the GL shed is a shade flatter at the corners (2.7% of a close cab frame, all inside its silhouette).
- Trap: a `gl/solids.js` record with no normal is read as a light. It skips the night dim (`uWLDim`) and the city's lamps and keeps its own colour. The shed's outside faces (the ones painted in `ex`) carry a normal and `amb` (`out` on `bayFace`); the inside and the fittings don't, because a lit workplace keeps its own light. Before that, Coldwater Regional's two hangars stood pale and flat after dark beside a city the mass pass had dimmed a second time.

Gate: `npm run gl:bay` ([scripts/shapes/bay.mjs](../../scripts/shapes/bay.mjs), in `shapes:smoke` and the push chain) checks the geometry arrives and stands up, the outside carries unit normals that never point down and the inside carries none, orbiting the camera moves none of it, moving the camera inside its own tile moves none of it, `glBay 0` collects none, and a GLASS 1 control still paints one. The `cam.ox/oy` check compares two sub-tile camera positions; a bounding-box check couldn't fail.

### One world scale for aircraft

`CONTACT_SIZE` is solved against the storey (3.5 m, so a tile is about 17.9 m), and `OWN_EXT_MUL` is 1, so your own aircraft draws at the size everybody else sees. Up to 10 m an aircraft is true size; above that its drawn span is 10 × √(real ÷ 10), so a Twin Otter is 14 m and the An-124 27 m. `chaseBack`/`chaseUp` were scaled by the same 1.84 the prop grew by, so the resting chase frames her as before. The truck and the hydro boat keep their own scale (`OWN_EXT_MUL_BY_CLS`), because the road and the sea are drawn at theirs. People (`ACTOR_S`, 1.75 m) and trees (`TREE_S`, about 7 m) are true size through `_trueK`, which is `_propK` without the seat's `propMul`. Birds are too: `BIRD_M_PER_TILE` in birds.js is 3.5 / 0.196, the flock sim and murmur.js convert every metric figure through it, and each species' drawn wingspan is the real bird's (`FAUNA_TILE` off `GOOSE_SPAN`, then the row's `scale`). See [systems-fauna.md](../systems-fauna.md).

### The aircraft hangar is the same shed

An airfield's hangar tile (`flags.aircraft_hangar`) derives as `mark: 'bay'` with `bk: 'air'`, and everything that sizes the shed asks `bayDims(cell)`: the drawer, the door sensor, the CFIT roof probe, `groundObstructionAt` and the occluder slabs. `HANGAR_BAY` holds every airframe but the Leviathan. A tile that also carries `flags.heavy_hangar` derives `bk: 'heavy'` and gets `HEAVY_BAY`, a shed 1.8 tiles square that holds her (1.51 across, 1.72 long, 1.17 to her fin). It overhangs its tile by about 0.4 on every side, so site it where that lands on apron or water, never a runway; Coldwater Regional's is at 929,904, at the end of the east taxiway. `isAirBay` is true for both. Only the floor, its paint and the fittings differ between the two kinds; the shell, the roof, the lights and both sinks are one code path. The door's picture is shared too; what drives it isn't.

- The height isn't just for the fin. The maintenance view's 3/4 camera orbits inside the building, because the cutaway is off, and a truck-height roof would put it on top of the roof.
- `setBayVehicles` takes any own ship and any contact on the ground, not trucks only. An aircraft rolling at a door used to find it shut. The cockpit marks a ground contact with `groundZ: 0`, not `onGround`, so both are read.

### A hangar door has a motor and a memory

The depot door is a pure function of where the trucks are (`bayDoorSense`). A hangar's isn't: `bayDoorOpen` hands an air bay to `airDoorOpen`.

- Outside, it's the depot's approach curve: up as you taxi at the door, down again as you roll away down the taxiway.
- Inside, it's up for an aircraft that came in through it, for the own ship with her engine running (`altOn`/`engineOn`) and for a contact rolling faster than 2 kt. Otherwise it's down, which is where Launch and Maintain put her.
- It travels at `AIR_DOOR_RATE` (half its height a second), so an engine start on the floor is a door you watch go up.
- Trap: a position curve can't do this. Launch stands her with her nose a hand's width off the door, so a curve either holds it up the whole time she's parked (the old whole-shed `IN_SENSE` did) or lifts it after she's through. And the field's ramp used to be next to the door, so every aircraft parked there held it open all day.
- Trap: the memory is keyed by world tile (`airDoorKey`, from `mapCenter + mapOffset`), because `dx, dy` move every frame. The first caller in a frame moves the door and the rest read it, so the occluder and the drawer agree. A door nobody asked about for a second snaps to its answer. `setBayVehicles(null)` forgets every door; the gates use it between cases.
- Nothing collides with a hangar door. `groundObstructionAt` is the truck's probe; an aircraft on the ground has no CFIT sweep.

Gate: [scripts/shapes/hangar.mjs](../../scripts/shapes/hangar.mjs) (in `gl:bay`, `shapes:smoke` and the push chain) checks the hangar arrives at its own ridge, orbiting doesn't change it, every airframe fits through the door (the Leviathan through the heavy bay's), under the head and inside the shed (`hangarFit`). On a clock it drives: the door opens for an aircraft taxiing at it and comes down behind her, stays shut for one put on the floor cold, rolls up (not appears) when she starts her engine, and stays up for one that taxied in and shut down.

Trap: every harness installs a GL hook that returns `null` (the no-WebGL2 path), so none reaches `drawSolids`. A stale identifier in that function passed all 26 shape gates, `client:smoke` and `imports:smoke`, and killed the GL pass on the first real frame. Use the Modelshop, A/B on `RENDER_TUNE.glBay` with everything else fixed.

Trap: don't cache-bust the import (`import('…/windshield.js?v=' + Date.now())`). It builds a second module graph; `install.js` imports `installGLWorld` from the unbusted specifier, so the hook lands on the old copy and both sides of the A/B come back pure 2-D and identical. Reload the page.

## Signal masts on the depth buffer

Reported as lamp posts showing through buildings. `drawStreetLamp` had already moved to the depth buffer (`npm run worldresidue` said so). The culprit was the signal mast: a pole, a cantilever boom, two hanging heads and a cobra-head street light on the same pole. It still painted on the 2-D canvas after the GL city, hidden only by `groundHidden` at its base (one point, all-or-nothing) and later `beginOcclusionClip` (a ~5 px cell grid eroded by one). A mast with a visible base drew in full, and the head is exactly the part behind the building.

It's drawn during the sweep now: steel through `emitWire`, plates through `emitDecoFill`, lenses as baked decals, lamps through `glowPool`. The world pass leaves 0 painters and 0 faces on the canvas, and `worldresidue`'s allow-list is empty.

- Moving off `emitFace` is the fix: a queued closure runs at flush, after the composite has nulled every sink, so it can't reach the stroke, decal or light layers.
- A lens is an octagon and a decal has four corners, so a lens is a baked texture on its bounding quad (not a six-quad fan; three lenses, two heads, two masts per junction), keyed with no camera term.
- Trap: `emitDecoQuad` takes projected points and `bp` returns a bare `[sx, sy]`. Passed that, `cam.unproj` returns null and the quad silently falls back to the canvas; the census caught twelve lenses still painting over the city.
- A lit lens's local `face` shadowed the `face` parameter: harmless with screen-space corners, wrong once a direction is needed.

Measuring it: only partial occlusion is a test, since the old probe also hid a fully covered mast. In the Modelshop with pinned clock and dice, an occluder over the mast's right sliver hides 2%, one covering its width hides 99%, and clear air is 125–200 px against a 9 px noise floor. Three things had to be pinned first:

- the clock (two renders differ by ~100k pixels from drifting clouds),
- `Math.random`,
- the CSS box: a canvas with no CSS size is resized by `paintWindshield` off its previous backing store, shrinking 760→418→255 over three renders.

Don't toggle `glDeco` between renders: that put the baseline at 183,666 px on a 125 px mast. Reload between configs, as with `glBand` and `richKit`.

## Echelon fittings on the depth buffer

Reported as the Echelon's lights showing through buildings. Her hull was already in `gl/solids.js`, but everything bolted to it came from one `emitFace` closure run at flush. The pad ring, rails, mast and radar bar, deck lamps, helipad perimeter lights, amber beacon, sidelights, wake and auto-land guidance dome are now drawn during the sweep: strokes via `emitWire`, lamps as hard sprites, the wake's foam V and bow moustaches as flat world quads via `emitDecoFill`, blooms via `glowPool`. `worldresidue` reports 0 painters and 0 faces again. Behind a low warehouse in the Modelshop: 0 leaked pixels, against 14–33 with `RENDER_TUNE.glShip` at 0.

- The fittings follow the hull, not the flag. If the collect throws or `glShip` is 0, the hull stays on the canvas and so does the original closure, because depth-tested fittings on a hull that draws through the city look worse than either.
- `emitWire`'s default pull (0.6 tiles) exceeds her half-beam (0.083 at `YACHT_SCALE`) and would slide a far-flank rail in front of her near side. These take `FACE_EPS`.
- Trap: a continuous value must never reach a decal key. The wake's turbulence fill took alpha from `spd`, minting a texture whenever the throttle moved (the unbounded-cache bug). Throttle now rides instance alpha and the colour is one of two.
- The same pass fixed every rooftop helideck, since `padCatchVolume` is shared; no census scene had ever carried a pad.
- A ship with deleted fittings also leaks nothing, so `scripts/shapes/yacht.mjs` counts the stroke, sprite and decal sinks with her in the scene and with the sea empty; all three must grow.
- From dead astern she used to show both sidelights, the far one painted over her hull. Now it's red 0 / green 9 at one heading and red 9 / green 0 at its mirror, per the rule of the road.

## Ground-pass dressing (`emitGroundLate`)

Reported as windsocks disappearing and missing runway lights. `SPRITE_SINK`, `STROKE_SINK` and `DECAL_SINK` are armed inside `drawWorldObjects`, so they're null throughout `drawGroundSurfaces`: every airfield drawer took its canvas path and the opaque GL canvas was blitted over it. At Coldwater Regional, 72 of 72 edge-light ops and 4 of 4 windsock fabric ops ran before the blit.

The ground pass now pushes a closure that the world pass runs beside the shadow drain (the seam `OWN_SHADOWS` and `LATE_BILLBOARDS` use); the drawers don't know.

- A closure captures its alpha as a value, because the ground pass sets `ctx.globalAlpha` per tile for the far fade and restores it after.
- Flat paint stays inline: `stripeA`/`dashedA` already record into `GROUND_MESH`. Only things standing on the tarmac are deferred.

## Windsocks

A windsock was two projected points and a pixel width clamped 1.4–8: flat at every range and the same from every side. `sockCone` builds a real one through `emitDecoFill`: five bands of `n` facets on a curve that droops from the swivel as the wind drops, at near-real proportions (5 m mast, 3.5 m sock, 0.9 m mouth).

- It moves, so it can never be mass: `emitFlat` records into the per-model mesh captured once at a frozen clock, which would fix the sock at whatever the wind was at `now = 1000`.
- Culling and `solid` go together: the tube is convex, so culling the far half halves the quads for the same picture, and `solid` puts the near half in the depth buffer so the cloud deck can't draw through it.
- A screen-space quad has all four corners at one camera depth (`quadBox`); a quad on a cone has four. The gate asserts that spread.

## Helipads

`c.pad` has been on the wire since the landing capture needed it (`deriveSurfaceCell` sets it from the airfield's `vtol_only`), but the renderer never read it. Threshold, the Gantry and the Ascension each drew a dashed centreline, piano keys, two PAPI arrays and two windsocks on rotorcraft-only pads. They now draw `helideck`, the Solenne's roof pad, already fully depth-buffered. A `dust` field stays dirt: the lawless strips have no paint, PAPI or edge lights, so the Gantry keeps its ruts and sock.

## Corner light-runners on hand-written towers

A corner light-runner lies on the shaft it traces and only needs to win a tie. At `emitWire`'s default 0.6-tile pull it's dragged further than the tower allows (its near face is ~0.44 from the tile centre), so the far-corner runner lands in front of the near wall. `helixRunner` already used `DECO_PULL` for the authored kit; the Solenne, Halcyon and the Ascendant spire were missed. Measured with `glself`: `named:solenneresidences` 34 leaked stroke points → 8, `type:asc_spire` 23 → 0, registry 663 → 614, `gl:mesh` unchanged at 59,133 faces.

## Airfield gate

`glresidue` and `glself` run model arms, so they can't see the ground pass. `node scripts/shapes/airfield.mjs` (`npm run gl:airfield` for the report; in the `pretest:regress` chain and in `shapes:smoke`) asserts the four silent claims, with a GLASS 1 control that must still paint everything. Mutation-tested 4 of 4: removing the deferral reproduces the original bug (15 sock / 132 edge / 16 green ops wiped), removing the cull leaves 20 of 50 facets facing away, disabling the `pad` branch loses the TLOF ring, and taking `groundLamp` off the sprite sink puts every lamp back on the canvas.

## Benches pin the adaptive dials

`framecost`, `__glFrame`, `__glLights`, `__glClouds` and `__glFlicker` all set `resFloor: 1` and `perfDS: 0`, because a loose dial sheds resolution where the frame is expensive and gets read as the renderer (see the Modelshop README). So a bug caused by a dial is invisible to all of them, and "worse in the cockpit" is often a dial report.

Trap: `PERF_DS` is still `Math.round((frameMs − 24) / 8)` with no deadband, bistable like `resStep` was. It's inert only because `drawMode7Floor` returns before the raster when `glFloor` is on, and won't stay inert if the GPU floor is switched off.

## The original GL spike

`client/game/js/panels/gl/` holds a WebGL2 world pass: GLASS's camera as a 4x4 (`npm run gl:parity`: 2,811 projections, worst disagreement 4.9e-10 px) and the city as triangles from the same primitives via `MESH_SINK` (`npm run gl:mesh`: 7,977 faces over all 173 models, each matching its collision shape). In the Modelshop (`__glBench()`) on a 73-building city, the 2-D building pass cost 3.6 ms, the same geometry in GL 0.02–0.04 ms, and 100x the triangles (286,600, all on screen) 0.67–1.06 ms.

These are spike numbers: a mass-only pass with no textures or adornments, driven from the Modelshop GL toggle, measured before any of it shipped. See tools/modelshop/README.md for the four criteria and the three ways the benchmark was wrong first.

## Moving parts (`RENDER_TUNE.motion`)

The **Moving parts** slider; 0 is the renderer as shipped. Wharf cranes slew and lift, a gantry trolley runs its beam, a grabber bites a scrap pile, a chain block pulls an engine, an arc welder stammers, clone vats breathe.

Trap: a moving part can never be mass, and nothing reports it. `draw3DBoxAt` and `emitFlat` record into the shape capture and per-model mesh, both taken once at a frozen clock (`captureRawPass` at `now = 0`, `captureModelMesh` at `now = 1000`) and cached per model. A clock-driven box animates in GLASS 1, freezes at `sin(0)` in GLASS 2, and collides as a third pose. It also passes `shapeLinearityError`, since a constant is affine.

- Everything that moves goes to the three per-frame layers: `emitWire` (strokes), `emitDecoFill` (decals), `glowPool`/`blinkLight` (sprites), which fit a jib, a hook block and a lamp. You can't fly into a hook block; the tower stays mass.
- Parked isn't absent: `motionPhase` returns −1 when the clock may not run, and every cycle makes the −1 pose equal the `u = 0` pose. The off switch gives a still crane, and the capture sees the same structure as the live frame.
- Measured one setting per process, the flag is worth +2 sprites across all 213 models (the welder's strike). Trap: measuring both settings in one run measures the cache, since the first pass fills the shape/kit/texture memos (several hundred phantom entries on models with no moving parts).
- Trap: `movingBox`'s `yaw` is a world yaw and arms work in local frames. `F`/`facePt` converts points only, so anything with its own bearing adds `faceYaw(E)`; without it the crane is right facing north (the one facing every harness renders) and rotated on the other three.
- `work` is the fraction of the period a machine runs, and the phase is offset by a tile hash, so cranes on one quay are never in step and most are parked at any moment. That keeps the skyline from looking like a fairground.
- An arc is two incommensurate sines over a threshold; `blinkLight` keeps perfect time and would read as a navigation light. It modulates a lamp, never the frame (the drug FX no-strobe rule).
- An authored model can't move: `case 'authored'` draws JSON boxes and drums straight into the mesh, so a building ported to `content/building_models/` loses its arm's motion when bound by name.

## Moving-part shading (`RENDER_TUNE.motionShade`)

`motionShade` 0 is the three flat fills as shipped.

Reported on the yellow south-west cranes; it applied to every `movingBox` (wharf jibs, quay gantries, scrap grabbers). Mass walls get `wallLit`'s two-stop ramp: tinted toward `mix(sky, key)` at the head and toward the shadow at the foot (the ambient occlusion that makes a facade read as solid). Moving parts had a top at the raw palette colour and two sides on one grey multiplier bottoming at 0.44, so a machinery house was the brightest thing beside the darkest, like cut-out card. It now runs the walls' arithmetic, composited in JS because the base is a flat colour.

- A decal's key is its colour, so a gradient has to be a texture. `emitDecoFill` takes a two-stop `ramp` baked into a 4x32 page through `bakeQuadTex`. The GL path never runs the 2-D `paint` closure, so a `fillStyle` gradient would reach nothing; the fallback lays the stops down the polygon's screen extent, as `wallLit` does.
- Both stops are quantised (`roofHatch`'s reason): a shade sliding with the slew would mint a page a frame and churn the 384-entry cache.
- The corners are the UVs: the ramp head lands on corner 0, so a side wound from its foot comes out lit from underground.
- The top is now the brightest face. The old top and lit side both reached 1.0, so under a high sun the box lost its corner. Sides run `MOTION_LO..MOTION_HI` and the top sits above both.
- The directional term replaced the old 0.44 floor; keeping both with the ramp's key tint and shadow foot sent the dark flank to black.

`scripts/shapes/moving.mjs` went red on a correct picture. Its third check reads frame fills and asks whether the container on the crane's spreader is the colour the ship's stow is about to gain, and it built that colour from `berthBoxColour` by hand. It now asks the renderer (`motionTopCss`, exported beside the berth constants, because a gate holding its own copy of someone else's arithmetic keeps agreeing with itself). That export needed `LAST_WORLD_LIGHT`: outside a frame there's no `LIGHT_STATE`, and the first cut returned the raw palette colour.

Truss members:

- `latticeBoom` drew top chord, bottom chord, diagonals and verticals in one colour. It now uses three shades: the top chord is the only member facing the sky and the web is partly shadowed by the chords. Free, since a stroke's colour is a uniform.
- It now dims at night. `movingBox` always dimmed its faces by the hour, but stroke colours were literals, so after dark the jib stayed daylight yellow on a dimmed house.
- `cssShade` refuses anything but `rgb()`/`rgba()`: `#ffcf3e` would hand its scanner a `3` and return a different colour silently.

## Lattice palettes for crane masts

Reported as an unreadable olive smudge on a crane. `ty_junk_crane` was in `PLATE_WALL` though its `draw3DBoxAt` is commented `// the lattice mast`, so `matPlate` painted plate patches, perimeter rust blooms and pitting on a member a fifth of a tile wide. With a plate grid of `max(5, W/2)` by `max(6, H/4)` that's two plates across with dozens of overlapping rust ellipses: mottle that reads as camouflage or brick. `LATTICE_WALL` was written for this ("a gantry leg, a crane mast, a fenced compound"), painting openings near-black with chords, diagonals, ties and gusset plates lit.

`ty_wharf_steel` was both the dock crane's pedestal and its tower. The pedestal is a squat machine base and is plate; the tower is sixteen storeys tall and a sixth of a tile wide. The tower now takes a new key, `ty_wharf_lattice`, galvanised and a shade under the jib's `rgba(120,128,140)` so the boom reads as nearer.

The family describes the surface, not the material: the same steel is plate on a hull, lattice on a mast, and `PLAIN_WALL` on a modern painted harbour crane. `ty_crane_body`/`ty_crane_cw`/`ty_crane_cab` stay in `PLAIN_WALL`.

## Cut lattice openings (`RENDER_TUNE.latticeCut`)

`latticeCut` 0 is the painted near-black openings as shipped.

`LATTICE_WALL`'s header assumed no alpha. In fact every wall texture starts transparent, `buildAtlas` composites tiles onto a transparent page with `drawImage`, and the mass shader samples that page. Leaving openings unfilled and alpha-testing gives a truss you can see sky through in both renderers, with no extra texture or blend pass.

- It's an alpha test (three lines): a discarded fragment writes no depth, so the sun-shadow and SSAO prepasses, which run the same program (the only one in `gl/context.js`), get the holes free and sorting doesn't change.
- Cost: `draw3DBoxAt` backface-culls, so a hole shows the world behind the mast, not members on its far face. Fine at a fifth of a tile; a visible cheat on a wide frame.
- The box stays solid to the mesh, CFIT sweep, occluder field and shadow, which read geometry. You can still fly into a lattice mast.

Three things would silently fill the holes:

- **Atlas skirt:** each tile is drawn oversized behind itself, then on top. With transparency the stretched ghost shows through the openings, so the cell is cleared between the two (a no-op for opaque tiles).
- **Night dim:** a whole-tile `rgba(0,0,0,0.40)` fill lays 40% black into every opening, so a cut tile dims with `source-atop`.
- **2-D quad overlays:** the lit ramp, face shade and fog fill the wall polygon, which doesn't know about holes (`sh` alone is up to 30% black). Masking needs a scratch canvas and a `source-atop` per wall per frame, so a cut wall takes no overlay in 2-D. GLASS 2 discards per fragment and lights the steel normally.

The flat LOD branch is exempt: a wall too small to texture must stay an opaque tone-matched fill or a distant mast vanishes.

Cutting changed the right proportions. Painted dark, fat members were fine at the 16x32 floor. Cut, two chords, a full-width tie per bay and two 2 px diagonals leave barely a third of a 16-texel section open, which reads as a solid column with pinholes. So lattice is now the eighth `hires` family (four keys against METAL's twenty-eight; measured with `atlasfit` at texRes 1, 2 and 3, same page sizes and band count), member widths are fractions of the section, and the web is lighter than the chords.

`LATTICE_CUT` is a subset of the family, because one key can be two objects: `ty_gantry` is a gantry leg at `fh * 0.05` in one place and the Spire cooling plant's deck at `fh * 0.86` (nearly two tiles of solid slab) in another. The subset is the three keys whose every call site is open structure. `ty_trm_gantry` is held out because it hasn't been checked, not because it failed.

The flag applies at bake time and needs a reload to A/B (like `glBand` and `richKit`): wall tiles are cached per palette, the atlas is packed from them, and neither key includes it.

## Rear and flank piers (section 1e of `derivedKit`)

Gate: `npm run models:elevation`.

Reported as "boring boxy buildings". `models:quality` couldn't see it: it's 94% satisfied and all four scores (a roof face, a light at night, more than one wall palette, any trim) are met by the front. Trim area against wall area per elevation: front 54%, left flank 21%, right flank 9.5%, back 0.5%, with 174 of 227 models under 2% on the back. Section 1d of `derivedKit` explains it: everything before it is placed on one plane, "so a building in Coldwater has a facade and three blank elevations".

Backs aren't only seen from the air. Of the 203 Coldwater building elevations facing a road tile, 58.1% are fronts, 18.7% flanks, 8.4% backs, and 14.8% tiles with no recorded entrance.

- A pier rank isn't a facade on a flank (1d's rule stands): no shopfront, awning, name board or glazing, since those derive from the one entrance. Piers are structure (warehouse flanks, party walls and sheds all have them), and the only part here that changes a wall's silhouette.
- Never lit: a light up a fin is advertising, and a building's back doesn't advertise.
- The pitch comes off the wall. 1b ties its fins to the glazing columns; here there's no glazing, so the wall's length is divided at the front grid's bay. Fins stand at interior bay boundaries, so a rank spans one bay less than its wall and can't overhang a corner.
- Result: back 0.5% → 25.9%, bare backs 174 → 30, +5,062 mesh faces (+9.4%), about 35 faces per building.

It exposed a latent normal bug in `emitFlat`: it takes the mesh normal from the polygon's winding (Newell) and never flips it, so a quad wound for a +y wall points into the building on a back wall, and GLASS 2 shades it as facing away from the light. Unreachable while 1b (front ranks at `fy`, positive on a centred mass) was the only caller. Two of the four quads already disagreed with their `cullN`: the +x return has claimed a −x normal on every building since the part was written. Each quad is now given the direction it should face and one function fixes the winding.

The gate reads the same field as the renderer, which is how it caught this (the first run filed a back rank as front trim). It measures area, not face count (a glazing ribbon is twenty quads, a plinth one quad round a building), and sets a floor well below the medians, so retuning is free and only an elevation going back to bare fails it.

## Camera pitch (`camPitch`)

`makeCam` takes an optional `camPitch` (radians, positive tips the view down). Before it, the optical axis was always horizontal: raising the eye was the only way to look down and a plan view wasn't expressible.

- The unpitched path is a separate closure, not θ=0 through the pitched one, because `f·1 + u·0` isn't the same floating-point expression as `f` and every view uses this function with no pixel coverage. `scripts/shapes/freecam.mjs` asserts the identity with `Object.is`.
- Trap: it's `camPitch`, never `pitch`. A view object already has `pitch`, the aircraft's attitude in degrees (four readers divide it by 26 or multiply by π/180), passed by all four cockpit callers. `makeCam` read it as radians for an afternoon, so each degree of climb tipped the camera 57°. `renderModelPreview` had named its field `camPitch` and then passed it on as `pitch`. `freecam.mjs` asserts a view with `pitch: 12` projects identically to one with none; restoring the bug moves `sy` from 442 to 53,006.
- Only the Modelshop preview passes a camera pitch. Before the sim uses one, the horizon line, the sky/ground fill (two rectangles split at `horizonY`) and cloud/fog placement all have to handle a moving horizon that can leave the canvas.

## The sea surface

Flags: `RENDER_TUNE.glSeaLit`, `glSwell`, `glSeaState`. 0 on all three is the flat painted plane that shipped.

The water already had three phase-modulated sine trains, whitecaps, sun glitter, a moon path, a surf band and a rotor crater, but none of it was differentiated (`floor.js`'s own comment: *"water is flat and carries its own wave shading below"*). The swell was a brightness multiplier on a plane, with no normal, specular, silhouette or anything riding it.

- `client/shared/sea-swell.js` is the one JS copy of the height field and `gl/sea-glsl.js` the one GLSL copy. Both `floor.js` and `water.js` read it, so the shaded surface and the displaced surface can't disagree.
- `scripts/shapes/sea.mjs` holds all three together. It's in the `pretest:regress` chain and in `shapes:smoke` (two lists, per the warning above).

## Swell versus chop

The three original trains have wavelengths of 1.09, 1.20 and 0.60 tiles (4 to 8 m), which is wind chop. Lit chop gives a sparkling sea rather than a rolling one, and a screenshot won't tell you which you have. A fourth train at 8.6 tiles carries the roll. It's the only term a hull may ride, because the other three are shorter than the Echelon's beam and would add noise to a rigid-body fit.

## Why the swell is a mesh

Parallax on the Mode-7 floor isn't feasible. The floor is one screen-filling triangle that recovers the world point per fragment by inverting the projection assuming z = 0, so displacing it is a fixed-point iteration with contraction factor `(d/EH) · |grad H|`. `uEH` (eye height in tiles) is 0.12 for a truck cab and `d` runs past 40, so the factor is 20 to 35: one iteration overshoots, two diverge. Past the near rows the frame is grazing, and a 2 cm crest moves the intersection by metres.

So `gl/water.js` is a real mesh. It displaces the 8.6-tile roll and the fragment shader keeps the ~1-tile chop, because a 0.6-tile wave needs about 13 vertices per tile against 3 for the swell (sixty times the grid for what a normal map already does). The grid is static: it holds tile offsets from the camera's ground point, is built once, and takes position, clock and sea state as uniforms. One draw call, no per-frame upload.

## Lighting

- The specular exponent is derived from the slope the amplitude produces. A near-level eye can only mirror light arriving within about twice the steepest facet, so at the shipped amplitude (6.9°) a tight lobe reflected only the horizon. Deriving it means roughening the sea widens the glitter with no second number to maintain.
- The diffuse is measured against the flat sea. A flat surface gets `dot(up, L)` (the light's elevation sine), so `(lam − elev)` is the facet's own deviation and is zero-mean at every hour. Trap: against a constant it carries the sun's height as a brightness offset and the whole sea drops about 9% at a low sun.
- Night moves 0% of the frame, which is correct. With the eye 0.12 tiles up and the moon 60° high, the mirror point is about 0.07 tiles away, under the truck. The existing `moon` path term is the deliberate non-physical answer.

## Cockpit light from the world

`cabinEnvLight` (windshield.js) feeds `pushInteriorShell` the three things the room's light used to ignore, all off fields already on the view:

- The moon: `moonIllum(phase) × elev`, only after dark and cut by cloud. It lifts the cab's ambient and cools the window key toward silver, so a full-moon cab reads and a new-moon one doesn't.
- Cover: off the mark under the vehicle, `COVER_BY_MARK`: a `bay` shed and the South Gate's covered `lock` road 0.8, the `gate` yoke 0.45 (a band of shade you drive under). Only below 40 ft, so a plane over a shed isn't in it. A seat that knows better sets `v.covered`; the hangar bay's cockpit booth sends 0.9. Cover dims the daylight, kills the sun glint, and counts as dark for the panel floods and cabin glare. Bridges, overpasses, sky links and arches have no tile type; they're building mass, so `overheadAt` asks the captured segments (the ones CFIT reads) whether any segment starts above the eye at that point with nothing solid at eye height. Five probes around the eye give a fraction, so driving out from under one fades. A new roofed mark gets a row in the table.

Trap: "mass above the eye" alone is true over every stacked building, so the first cut called the inside of a warehouse wall a bridge. The clear-air condition is what makes it an underside.
- Attitude: the sky's direction in cab space from `bank` and `pitch`. The overhead share of each face's light and the roof-bright height falloff follow it, so inverted the footwells are lit and the roof is not, and the sun glint is turned with the airframe.

- Street light: `applyCabinStreetLight` adds street lamps, neon and lit signs to the cab after dark. The lights are the `SPRITE_SINK` list the wall wash reads, which fills while the city draws, after the cab is shaded, so the pass runs just before the GL hook and adds onto the faces already in `OWNSHIP_SINK` (the interior upload compares every value, so the change is sent). Each lamp is one direction and strength across the whole cab, since the cab is hundredths of a tile across; the strongest six within 1.4 tiles are kept. `RENDER_TUNE.cabStreet` 0 turns it off.

Trap: a lamp to the right lights the LEFT of the room. Light through the right-hand glass lands on the surfaces facing it; the first version of the check expected the right side to brighten and failed on correct lighting.

Trap: only lights that were drawn reach the sink, so a lamp behind the camera doesn't light the cab. Lighting from behind would need the world pass to push off-screen lights, which costs every frame.

Trap: the up vector is in the shade cache's frame key. It's rounded to hundredths so a steady bank still hits the cache. `scripts/shapes/cabin-light.mjs` checks all three by direction.

## Cockpit light on the GPU (`RENDER_TUNE.cabGPU`)

GLASS 2 comes first here, and GLASS 1 may be the plainer picture. The 3-D cabin only exists on GL anyway (`pushInteriorShell` returns without `OWNSHIP_SINK`); GLASS 1 draws the 2-D cab.

- With `cabGPU` 1 (the default), `pushInteriorShell` doesn't shade faces. Each face goes up with its albedo (trim, cabin retint and grain folded in) and a 24-float material record, `q.cab`, cached per face object in `CAB_GPU`. The frame's light goes up once as `OWNSHIP_SINK.interiorLight`. The layout of `q.cab` is at the top of `gl/solids.js`.
- The interior layer is `createSolidsLayer(gl, { cabin: true })`: the same layer with `CABIN` defined. `cabinShade` runs the per-face model per pixel in the cab's own frame (`vLocal`, metres about the eye): the window key, attitude, the height falloff, floods, sheen, the metal ramp and its reflection, clear coat and the glint. Floods are pools across the board now, not one value a face.
- New on the GPU: the direct sun, occluded by the room. A 1024² depth map from the sun, orthographic over the box of this frame's faces in cab metres (`lightMat`), drawn once a frame before the room. It gives sun patches through the glass and pillar, frame and yoke shadows that turn as you bank. Panes (`kind` −1) are clipped out of the pass, so glass lets the sun through. `cabSun` 0 drops it; `cabSunGain` (2.5) sets its strength. At 1 the patches drowned in the sky light.
- The city casts into the cab too (`cabWorldSun`). The context keeps each frame's city sun map (`worldSun`) and the cabin shader tests each pixel's world position against it, so the dash loses its sun in a building's shadow. On a 195-tile scan of Coldwater at 14:30, 77 cab positions come out shadowed. A roofed mark still uses cover, because the map holds building mass, not sheds or the lock.
- Trap: keep a copy of the city's light matrix, never `mat4f`'s return. That's a shared scratch array the next draw overwrites; kept as-is, the cab sat above every roof in the map and was never shadowed.
- Both maps are read as plain depth and compared by hand (NEAREST, `COMPARE_MODE` none), not through `sampler2DShadow`: on ANGLE/D3D11 the hardware compare came back saturated for the city's map (see gl/shadow.js). The layer builds its own map on the first draw even with no sun, so its sampler always has a texture.
- Cost, whole-frame medians in the Modelshop: truck 34.7 → 34.0 ms, Drake 67.5 → 64.1, Mule 59.7 → 56.3 (CPU shading → GPU with both shadow maps). The per-face CPU shading it replaced cost more than the depth pass.
- `cabLightLast()` (windshield.js) returns the last frame's light, for a console or a bench.
- `__street`'s first call after a reload draws no cockpit, with either setting. Call it twice.

## Sea state from the wind

- The sea reads wind in knots. `windFromView().fly` is `clamp(kt/18)`, the windsock's curve, which saturates at Force 5. Sea state instead uses JONSWAP fetch-limited growth, `Hs = 4·U·sqrt(1.6e-7·F/g)`: 0.29 m at Force 2 to 3.23 m at Force 10.
- It's driven by wind and not gloom, because fog is `WX_HAZE 0.75` and a foggy sea is glass.
- It goes through a reservoir (`SEA_RISE_S` 150, `SEA_FALL_S` 420, the exact-step form `ground-accum.js` uses). Otherwise per-cell severity snaps as you cross a squall boundary. A real sea also takes minutes to build and longer to fall.
- The trains are Stokes 2nd-order, `a·sin θ − (ka²/2)·cos 2θ`, giving surface skewness 0.154 at full sea state (observed seas +0.1 to +0.3; a sinusoid is 0).
- The whitecap threshold is inverted rather than fitted. The shipped thresholds were absolute (`wv > 0.78`), so scaling amplitude made a calm sea foam everywhere and a storm nowhere. The threshold is now a quantile of the chop's own distribution that hits Monahan and O'Muircheartaigh's coverage (`W = 3.84e-6·U^3.41`), tracking to 1.49 points across Force 0 to 10 and immune to swell retunes.

## The ship's ride

- Deck height is one function. `YACHT_DECK_Z` (windshield.js) and `DECK_PAD_Z` (cockpit.js, which restated `YACHT_H` as a literal 1.7) were two constants; with a heaving deck that means a helicopter landing on a deck that isn't there. `DECK_PAD_Z` is deleted, `yachtPadZ()` is the one answer, and the gate fails if the constant returns.
- The attitude is a fitted plane, never the slope at a point. A 60 m hull spans much of an 8.6-tile swell and bridges it. Three samples (bow and both quarters) give heave, pitch and roll, applied at `drawYacht`'s single `lift()` so hull, superstructure, pad, rails, mast and lights move together.
- A hull takes up a fraction of the geometric wave slope (the effective wave slope coefficient). At 1.0 she rolled 29.9°, a knockdown. At 0.55 with caps, `sea.mjs` measures 11.1° roll and 11.0° pitch at worst in a gale on every push.
- Wake foam follows the surface. A flat `z = 0.003` left foam hanging over troughs and buried under crests.
- Trap: the physics must not depend on the floor having drawn. The first cut read amplitude and clock from state `drawMode7Floor` publishes, which never runs under the DOM stub, so the hull measured dead flat. Amplitude comes from the tune, the clock from `now`.

## The sea clock

A GLSL uniform is float32. At the roll's 0.31 rad/s, `Date.now()` is about 5.5e8 radians, where float32 resolution is 64 radians (ten waves between representable values), so the GPU sea would stop while the JS kept moving. `seaClock()` wraps at `2π/0.01 = 628.3185 s`. The wrap is exact because every temporal frequency in the sea and the floor's water block is a multiple of 0.01 rad/s: the surface at `t` and `t + 628.3 s` differs by 2.0e-14 tiles.

- The one exception is the rotor downwash, whose frequency is a live control input. Its phase steps once every ten and a half minutes under a hovering helicopter, over water already churned into a crater.
- Because the sea is a pure function of position and wall-clock time, a server can verify a boat's pose by calling the same module, with no table, tick or egress.
- `seaScroll` is gone. It offset sampling along the heading so water streamed past a ship pinned at screen centre, was disabled at its only call site (*"it read as fake"*), and stayed plumbed through four files to a zero uniform. It was the last per-client term; reviving it fails the build.

## Shader traps

- A backtick inside a GLSL template literal ends the string (the `cab-view.js` boot bug one layer down; four occurrences across three files).
- GLSL has no default arguments. `seaSlope` gained a sixth parameter while `floor.js` passed five, the floor shader silently failed to compile, the pass fell back to 0, and the software raster drew the flat sea under the GL water. `gl:glsl` checks names only, so `sea.mjs` checks arity.

## Measurement

- Frame cost here is unmeasured: the same config read 2.8 ms and 0.9 ms on consecutive runs, inside the spread.
- The picture: the lit term moves 22 to 38% of a daylight cab frame (strongest at low sun), and the displaced mesh 13.4%, with the horizon no longer a ruled line.
- Instrument: `__glSea()` in the Modelshop with pinned clock, pinned `Math.random` and an ablation frame at flag 0 (because "the two agree to 0.15%" is also what a path drawing nothing returns). Warm it once; the first case's control reads 68% while lazy caches build.

## Crest translucency

Flag: `RENDER_TUNE.glSeaSss` (0 is the sea as shipped). The green glow through a wave top is light passing through the water, which reflection and specular can't express.

- It isn't real subsurface scattering, which needs a thickness; this sea is an opaque skin over a height field (as `matFrost` records). It models the three conditions: sun in front (`-dot(V, uSunDir3)`; an `abs()` or dropped minus lights crests with the sun behind you and passes every other check), sun low (a steep sun goes into the water), and a crest to light (the lift is `vH`, the mesh displacement, so a glass day contributes zero).
- Green over blue over red, because water absorbs red first and blue second. Lifting green and blue together makes cyan, which read as a neon tube at gain 1.4.
- The default was set on screen at 1.2. The pixel bench reads this term at 0.15 to 0.37% because it only lights sun-side crests in the displaced patch; the sweep suggested 0.55 (invisible), and 4 stains the water.

## Wake foam trail

Flag: `RENDER_TUNE.glFoam` (0 is the sea as shipped). `seaWake` draws the bow crest and Kelvin arms from the hull's current position, so the wake swung with the boat. The trail leaves foam on water she has crossed, which stays straight when she turns.

- It's the snow track store with a different decay law. The commit rules moved to [client/shared/trail-store.js](../../client/shared/trail-store.js): provisional head, early bend, creep floor, second point opening on first movement, spent point leaving.
- A wake is one band. The snow shader measures `abs(d - half)` for two wheel tracks; copied here it draws a catamaran.
- Foam is the one part nothing reads back (no physics, server or gate), so it may be per-client, stateful and approximate.
- `npm run gl:trail` ([scripts/shapes/trail.mjs](../../scripts/shapes/trail.mjs), in the `pretest:regress` chain and `shapes:smoke`) drives the pure module, mutation-tested 7 of 7. It exists because `gl:snow` (gauge, bend, burial) caught the bend and missed the provisional head and eviction.
  - Its bend case uses a junction's radius. 90° over six tiles is 8.25° per step against a threshold of 8, which sits on the edge.
  - Its creep case drives in first. The turn term is 0 with fewer than three stored points, so a standing-start shuffle is held by that and deleting the creep floor stays green.
- Traps found in this feature:
  - `half` is a reserved word in GLSL ES. The water shader never compiled and the entire GL world pass fell back to 2-D, with every headless gate green (`gl:glsl` never compiles). The tell was 2 draw calls in a forty-frame sail. It's a build failure now.
  - Foam first went into the ground state beside `tracks`, a different object, so `water.js` read `s.foam` as undefined and drew nothing while the store filled. `gl:opts` can't see this (it guards the install.js allowlist).
  - Foam lives 40 s and the bench sail took 29 s for sixty frames at 900×500, so the shot showed the trail at a tenth of its brightness.
- Measured once fixed: 0.27% of the frame, peak 149 levels, against a 0.02% control.

## Spectral spread

Flag: `RENDER_TUNE.glSeaSpread` (0 is the single-train sea, bit for bit). A single train repeats exactly every wavelength, and at 60 m scales phase modulation can't hide it. Each peak gains two sidebands. `SEA_ROLL` and `SEA_WIND` are unchanged because the sea audio reads them for LFO rates and a gate pins them. Measured: 11.4% of a gale frame against a 0.02% control.

- No FFT. A Tessendorf ocean produces a texture, and four readers (floor shader, mesh vertex shader, ship physics, gate) include two on the CPU. That means a 256² JS FFT every frame, a GPU readback no server can do, or a disagreeing coarse copy. A sum of trains drawn from the spectrum stays closed-form, differentiable, CPU-samplable and deterministic.
- Frequencies are snapped to the 0.01 rad/s grid, or `seaClock`'s wrap puts a seam in the surface every ten and a half minutes on every client.
- Wavenumbers come from ω² = gk, or sidebands drift through their peak.
- The spread is an angle as well as a frequency; only a crossing angle stops crests staying parallel.
- The band is normalised in quadrature. A linear share returns a sea 31% calmer at the same sea state, and dropped skewness 0.154 to 0.087. A `SEA_SHARP` factor had been added to boost the Stokes term back; it's removed. With energy preserved the peak keeps 96% of its height (not 62%) and skewness is 0.146 unaided.
- Sidebands are generated from the JS table: `gl/sea-glsl.js` imports `client/shared/sea-swell.js` and interpolates. The peak trains are still a hand-written GLSL twin held by a gate.
- The emission check looks inside each function. The slope generator emits the same sidebands as the height generator, so a file-wide check passes when one drops a band, and so would the analytic-slope check.
- Two invariants are invisible to aggregates (peak keeping full amplitude moves RMS 3.6%; sidebands at the peak's wavenumber change no measured statistic), so both are checked in the algebra. Mutation-tested 6 of 6.

## Sea benches

- `__glSea` set `RENDER_TUNE.glSeaRoll`, a key replaced by `glSeaState`, so half its measurement did nothing.
- `settleFade` pins `performance.now` while `seaClock` runs on `Date.now()` (so two players see one ocean), so waves moved between paints: the control differed on 58.7% of pixels under a 17.6% signal. Pinning both clocks brings the noise floor to ~0.01%.
- `__glSeaShot` paints one frame and leaves the canvas up, for judging whether it reads as water. Its `sail` mode drives a boat over frames because foam needs history. The camera is the boat, so a forward shot shows no trail, and the map recentres on her each frame, so a half-and-half scene keeps her on the shoreline.
- `__glSeaCost`: a GPU-floor sea frame is 1.5 to 1.9 ms at 640×360; the three sea layers read 0.15, −0.29 and 0.15 ms against a 1.5 ms spread, and 2560×1440 barely moved it. The control shows the bench works: `__glFloorCost` resolves the same scene at 208 ms on GLASS 1 against 1.86 ms on the GPU floor (112×). The height field could carry several times more trains, but per-pixel trig is what integrated GPUs are worst at and every number is one discrete NVIDIA card.
- `foamReset`: foam is the only stateful part and ages on the wall clock, so a shot painted after a sail carried its decaying wake. The noise floor on a boatless scene went from 0.02% to 4.53%, including readings that first suggested refraction was invisible. `__glSeaShot` now clears it at the start of every shot.

## Harbour shelter

Flag: `RENDER_TUNE.glSeaShelter` (0 is open sea everywhere). Water with land close upwind stays flat however hard it blows: an offshore gale leaves the lee shore glassy and the windward side rough.

- `seaAmpsFor` already takes fetch (JONSWAP is a fetch model), so shelter asks it a local question. Each water tile searches 40 tiles upwind for land and stores the answer in `uLut1.a`, which was a constant 255, so it costs one write per tile and one swizzle.
- The wind bearing is in the cache key, quantised to sixteen sectors. The grid rebuilds only when the window recentres, and a raw bearing would rebuild it every frame.
- The fetch reference isn't `SEA_FETCH_M`. That's 50 km against a ~350 m map window, so every visible tile came out under 7% and jumped to 100% at the search limit, a hard line across the water. The shape is still √fetch; the reference is the search length, so shelter is 0 against a beach, about a fifth two tiles out and exactly 1 where nothing is found.
- Upwind, not nearest land. A distance transform is cheaper and wind-independent but would calm a bay whichever way the wind blows.
- Running off the grid counts as open water, or a calm band follows the frame edge.
- It scales the swell only. Short wind waves form over metres and exist even in a dock.
- Measured in a channel at full gale: 4.7% of the frame, peak 212, against a 0.02% control.

## Hull inertia and roll response

Flag: `RENDER_TUNE.glSeaInertia` (0 is the kinematic fit). A hull matching the fitted plane exactly has no mass.

- The lag is taken in time: the fit is evaluated at three instants and averaged. A weighted sum of past fits is a real low-pass with a phase lag and stays a pure function of (position, heading, time), so clients agree exactly, the sea stays server-verifiable and `yachtPadZ` stays pure. The taps sum to one, so a glass day is exactly flat.
- Trap: a stateful spring stepped by the wall clock is wrong. `yachtRide` is a positional query (the deck, the helipad and the telescope mount ask about different points and headings), and one integrated attitude collapsed them all, so the deck stopped heaving over time, across position and with heading. Three gate claims caught it.
- Measured: she trails the water by 0.70 s and takes up 91% of its movement.
- A symmetric filter can't resonate, so roll response is a per-train RAO (Response Amplitude Operator: a gain and phase per frequency), built 2026-09-27 as `rollRao`, flag `RENDER_TUNE.glSeaRao`. The roll fit splits exactly into swell and wind-sea rolls, each scaled by a damped-oscillator gain and sampled at its own phase delay. Natural roll 0.36 rad/s, ζ 0.2. A beam gale rolls her 4.5° → 9.8°, the head sea stays lower, worst over the sweep 12.8°. Encounter frequency is taken as the wave frequency (the function has no hull speed), which understates following seas. Gated in `sea.mjs` section 31.

## Shoaling refraction

Flag: `RENDER_TUNE.glSeaShoal` (0 is the sea as shipped). Waves slow in shallows, so crests swing round to parallel the shore.

- It's a domain warp on the sampling position. Rotating each train's `k` makes the true phase `∫k·dx`, so `k·x` stops being a wave, crests stop joining and the analytic slope stops being analytic. With `p' = p + t·g(d)` the effective wavevector is `k·u + k·(u·t)·∇g`: oblique trains gain the shoreward component and square-on trains are left alone. An oblique crest turns from 44.2° to 38.9° off the shore normal.
- The warp must be injective or it folds. `coastWarp` shipped a Jacobian determinant of −2.13 (cusps along every shoreline, a pond as a starburst). This one stays at 0.975; the fold threshold is between strength 3 and 4.
- The slope is taken in the warped frame, an approximation: lighting is off by order `|∇g|` (about a fifth, tangentially, inside the shoal band). Doing it properly needs second derivatives of the tile grid, which a texture gives noisily.
- It's visually below the noise floor at every injective strength and seat (0.02% against a 0.02% control), because it only touches a 2 to 4 tile band seen edge-on. It ships at 0.55 because it's correct and free.
- Two gate claims were fixed. The injectivity check used a straight shore, where the Jacobian is a pure shear with determinant exactly 1 for any strength; it now uses a round island. The sign check reimplemented the warp in JS, so flipping the tangent in GLSL stayed green; it now reads the sign from the shader. Trap: a gate that rebuilds its subject tests itself.

## Surf and breaking

Flag: `RENDER_TUNE.glSeaSurf` (0 is the sea as shipped, with the swell tapering as `deep²`).

- The swell shoals by Green's law (H ~ h^-1/4, capped at 1.6×) and breaks at 0.78 of depth (McCowan), so a storm breaks further out. Each crest brings foam in and leaves froth; the floor's surf band runs up the sand on crests and back in troughs, leaving wet sand.
- Depth is `seabedDepth` from `client/shared/seabed.js`, the submersible's model. `floorLutBytes` builds it as a third per-tile plane (metres × `SURF_DEPTH_Q` in one byte) on the shore distance transform; the floor owns the texture and the water layer samples it on unit 6.
- Trap: keying surf on `deep` (the ~1-tile waterness ramp) made a surf zone a quarter-tile wide.
- The beach is eased (`BEACH_W` in `seabed.js`). The shelf's exponential gave 6.5 m of water one tile out, so everything broke within a tile. The term is now `d²/(d + BEACH_W)`: 1.2 m at one tile, 3.9 m at two, 15.6 m at five, shelf floor and drop-off unchanged. A 4 m sea breaks about 3 tiles out, a 0.5 m sea at the sand. The submersible's 3 m `MIN_WATER` is now reached about 1.8 tiles out instead of half a tile.
- A height field can't overturn, so a breaker is a forward pitch (`seaSurfLean`, in slope and height) plus foam.
- Hulls ride it: `hullSurfGain` in windshield.js (from `surfHullGain` in sea-swell.js) scales the swell for `seaPoseAt` (the Echelon's ride) and the hydro in boat-view.js, from `floorZAt` under the hull. It's exactly 1 in open water and 0 on sand.
- Trap: `floorZAt` returns 0 on land and before any seabed window is noted, which flattened the Echelon on headless runs and early frames. `seabedWindowReady()` guards it; unknown depth reads as open water.
- Constants and a JS twin (`surfGain`/`surfBreaking`) live in `sea-swell.js`; the GLSL interpolates them. `sea.mjs` section 26 gates: flag 0 = `deep²`, zero at the waterline, one gain for mesh and lighting, depth from `seabedDepth`, the physics on the JS twin, `uSurf` set on both layers. Measured from a cab facing the beach: 6.8% of the frame against 0.01%.

## Far swell

Flag: `RENDER_TUNE.glSeaFar` (0 is the sea as shipped). Past the 28-tile patch the floor was lit but flat, so nothing stood above the horizon.

- A third tier on the graded grid (`PATCH_FAR_R` 120, `PATCH_FAR_STEP` 4) carries the long swell only, at 6.4 samples per wave. The wind sea hands off to the normal map at the old rim (as the chop does at `glSeaChopR`). The mesh went from ~19k to ~34k cells.
- Haze stops `uFarBody` (0.22) short of the horizon colour past the patch; hazed fully to `uHor`, crests were sky-coloured against the sky and changed 0 pixels.
- From low seats in a big sea it's hidden, correctly: boat and cab eyes are 0.06 to 0.12 tiles up and crests at sea state 0.7 are several times that. From the aircraft it's 4.9 to 5.9% of the frame at sea state 0.7 to 1. Storm haze also hides it.
- `sea.mjs` section 27 gates roll sampling in the far band, the wind sea inside the near rim, the haze cap, and the flag reaching the water.

## Displaced chop near the eye

Flag: `RENDER_TUNE.glSeaChopR` (0 is chop lit but flat at every range). A normal map lights a flat surface, so a nearby crest had no edge, occluded nothing and didn't break the horizon. Measured: 4.6% of a cab frame and 4.0% of a helm frame against 0.01%.

- It's displaced over six tiles from the eye and faded out; beyond that the normal carries it. The taper is required: the floor past the patch displaces nothing, so full-height chop at the rim is a step that follows the camera.
- The grid has to resolve it. A sine needs about five samples per wavelength, the shortest chop train is 0.60 tiles, and `PATCH_PER_TILE` went 5 → 9 (5.4 samples). Under-resolved displacement reads as torn geometry, silently, because the lighting still describes a smooth wave.
- Lighting didn't change; the fragment normal already comes from the same height field.
- 3.2× the vertices (64k against 20k) measured free: 0.14, 0.38 and −0.13 ms across three seats against a 1.5 ms spread.
- `sea.mjs` had forbidden `seaChop` in the vertex shader. That's still true of the whole patch; the claim now requires the taper, and an untapered call still fails.

## Foam keyed on steepness (not built)

Keying whitecaps on `|grad h|` was measured and rejected. Over 20,000 samples, chop height and steepness correlate at −0.06. Slope is zero at a crest, so slope-keyed foam lands on the flanks. Curvature (a second derivative, closed-form here) is what separates breaking crests, and is a real piece of work for a subtle gain.

## Hydro launches

The race boat gets air off a crest and lands on whatever is there (a bad landing scrubs speed; beam-on breaks the hull). At full throttle into a 45-knot gale (the top of the scale) it made zero launches in two minutes. `launchVs` and the `kick > 0.25` bar were fitted to a fixed roll 0.32 / wind 0.20 sea (about 28° of face); the JONSWAP sea is about half that, 16.1° at `SEA_FULL_KT`, and would need about 95 kt to reach roll 0.32. Trap: a number fitted to another system's output goes stale when that system is retuned, and here silently, because a grounded boat looks like careful driving.

- Lowering the bar isn't the fix. The launch speed is the kick (`s.vs = kick`), so a lower bar gives more launches at the same height: at 0.03 the hull left the water 357 times a minute and never cleared 0.011 tiles.
- `launchVs` 0.55 → 0.9 restores the feel: 13.5 launches a minute (old sea: 13.0), peak 0.033 tiles (0.036), airborne 7.9% (7.8%).
- `sea.mjs` section 21 reads `seaAmpsFor`, `glSeaGain` and `SEA_FULL_KT` from source and asserts height as well as occurrence, plus a flat-calm control. Mutation-tested 3 of 3; restoring 0.55 reproduces the bug.

## Neon glitter on the harbour

Flag: `RENDER_TUNE.glSeaNeon` (0 is the sea as shipped). A night harbour was black under a lit skyline: the planar mirror moved 0.70% of the frame at peak 15/255 (against 20.1% on a wet road), because broken water destroys the image. The floor.js per-light smear is gated `uWet > 0.001 && pavedW > 0.02` (rain, tarmac), both zero over a clear bay. With this term: 23.8% of a night cab frame.

- The model is the surface slope distribution, per Cox & Munk 1954 (JOSA 44:838): a streak is the probability a patch is tilted to bounce the light to your eye. It's near-Gaussian and anisotropic (σ²ᵤ = 3.16e-3·U along the wind, σ²_c = 3.0e-3 + 1.92e-3·U across), so the path is an ellipse stretched downwind. The tarmac smear, two hand-fitted Gaussians, suits a rough opaque surface.
- The wind is already integrated, so glass gives a tight bright path and a gale a long dim one: glass moves 2.7% of the frame at a higher mean than the gale's 26.6%.
- Using the full ocean variance is correct: it includes capillary ripples, which the renderer doesn't carry (nothing below half a tile), so the statistics stand in for the unresolved spectrum.
- Both axes use the clean-surface intercept, departing from the published fit. The along-wind regression's near-zero intercept makes a windless sea a perfect mirror along one axis (anisotropy 0.18 at 0 kt, a path stretched across the wind, peak 22× reference). Above about Force 3 the two forms agree to a per cent.
- Ways it read zero while wired:
  - Use `rgbRaw`, not `rgb` (as the wet road and wet specular do). `rgb` is the wall-wash colour, scaled by that term's gain and the night; on the bench all sixteen lights had `rgb` [0,0,0].
  - The wall wash's reach is a hard cut, which zeroed every light more than 2.2 reaches away. Falloff is `1/(1 + (d/r)²)`, so distant signs are dimmer but present.
  - `water.js` draws no mesh when swell is zero, so the glitter is in `floor.js` too; the floor also covers everything past the 14-tile patch.
  - `runSeaShot`'s coast was parkland, so `glMirror: 0` and `glSeaRefl: 32` were identical. It takes `city: true`, with the city on the quay: six tiles of beach pushed every streak to the last rows before the horizon.
- `water.js` binding the mirror buffer on unit 3 is not a feedback loop (unlike `ground.js` leaving `uRefl` on unit 1, which `mirror.js` clears). A loop needs the texture on a unit an active sampler of the current program uses, and the mirror pass samples nothing on 3. Five frames with every draw checked: 0 failed draws, mirror buffer stable at 12.84% lit.

## Underwater camera

`RENDER_TUNE.glSeaDunk` (0 is the renderer as it shipped) handles the camera going under the surface. `glSeaUnderExt` is the extinction strength.

Every seat is floored at 0.05 tiles above mean sea level (`Math.max(0.05, …)` in windshield.js). A crest reaches 0.099 tiles at 10 knots, 0.199 at 22 and 0.404 at `SEA_FULL_KT`, so from about Force 4 a low camera is ducked by up to eight times its height above the mean. Over a long sweep, a camera at that floor in a 45-knot sea is under the surface 36.3% of the time. Above 22 knots a crest tops even a fixed bridge eye at 0.115. The Echelon's eye rides the sea, so she clears; a chase seat or free camera near the water doesn't.

Before this, nothing tested for it, and the result was worse than a missing effect. The mesh is drawn two-sided and depth-writing (`disable(CULL_FACE)`, so a trough seen from a crest shows the far side of the wave), so the surface overhead was already drawn, wearing the sky reflection, sun glitter and whitecaps it wears from above, under an air sky with air fog. With the flag, 33.4% of a submerged frame moves (mean 119), against 0.03% above water on a 0.06% control, so it's inert when you're dry.

- **Snell's window.** Looking up from inside water, the whole sky is refracted into a cone of half-angle 48.6° (`asin(1/1.33)`). Outside it, total internal reflection turns the surface into a mirror. So there's a bright disc overhead, a dark mirrored ring round it, and a sharp edge between. It's one dot product against `cos(48.6°) = 0.661`; an `acos` would buy nothing.
- **Extinction is per channel.** Water absorbs red first, green next, blue last, so anything past a metre or two goes blue-green and then disappears. A grey fog reads as smoke. It's one `exp()` per channel.
- **The structural limit.** `drawMode7Floor` inverts the projection assuming z = 0 with the eye above, so it can't draw a surface overhead, and past the 14-tile mesh patch there's no surface geometry overhead. Real underwater visibility is 10–30 m (1.5–4 tiles), well inside the patch, so the extinction the physics calls for also hides the region with no geometry.

Trap: the first gate was `v.biomeBelow`, a string only some callers set (the helm view sets it, the cockpit doesn't, no bench does), so the feature moved 0.00% of the frame. It now reads the LUT's waterness at the camera tile (`LUT[y][x][3]`, the per-tile material grid the floor and both water shaders sample). `LUT` starts `null` and is built conditionally, so it's guarded.

Trap: the submersion was first computed beside the fog, sixty lines above `const t = seaClock(…)`, which is a temporal-dead-zone `ReferenceError` on every frame. The pass catches, logs once and falls back to 2-D, so the whole GL renderer would have turned off with one console line. Same shape as the `cam.ox` bug.

Trap: two separate questions. "Is the camera under" is one scalar and sets how much water you look through. "Is this fragment seen from below" is `gl_FrontFacing` and decides whether it's a ceiling. With the eye at the waterline and a crest between it and the horizon, half the surface is over you and half is in front of you, and a single camera-wide switch shades half of it wrong.

## Chase camera following the Drake under

The external chase follows her down at her own rate and keeps her framed, so she goes under first (seen through the waterline split) and the camera follows a moment later.

- **The arc already sinks with her.** The chase arc is centred on her model, and `ownShipBaseWz` carries `rideZ`, so the eye goes down exactly as far as she does. Don't add `rideZ` to the eye as well. A `chaseSubSink` term did, and the eye sank at twice the hull's rate.
- **The arc's floor goes down with her too.** `groundPitch` kept the camera 0.06 over the sea surface, so as she dived it swung the orbit up over the top, and `topFrac` pulled it out 2.4x. By 8 m the camera was looking down on a speck. Under water the floor is `0.06 + rideZ`, which matches the surface's at the start of a dive, and never lower than the seabed under her and under the camera (`floorZAt`, only once `seabedWindowReady()`; before that it answers 0, which is the surface).
- **The eye doesn't stop in the wave band** (`chaseWaterline`). A lens a few centimetres under the mean surface has the troughs hanging below it, and from under water a trough is a bright mirror: a crescent of light across her. She can hold any depth from `SUB_CEIL`, so cruising at about 3 m parked the camera there. The eye keeps a side. Below, it stays at least `b` under, where `b` is half the significant wave height plus 0.015 tile, and it eases back to its true depth over the next `b` down. It changes side only 5 mm past the surface, and the offset eases over 0.1 s, so the crossing is one quick pass.
- **The crossing is drawn.** The chase lens gets `drawCrossing` (the plunge, the breach and the lens under water) as the free camera does, at the free camera's mass (0.15), not the hull's, so a follow doesn't white out.
- **The waterline split is off once the eye is under.** Its gate only asked whether the camera was near the water, and being under it passes that, so a fake waterline and murk sat over the underwater pass all the way to the seabed. Birds are off under water too.

Picture: `__glSeaShot({ shore: true, extra: { cls: 'drake', external: true, drakeWater: true, drakeFloat: 1, subHull: m, rideZ: -m / 7, extPitch: Math.asin(0.405 / 2.95) } })` in the Modelshop, stepping `m` through the crossing. Each shot takes a new WebGL context and the page runs out after about nine, and the frames go black, so reload between sweeps.

## Seabed view

The Drake under water (plugins/submersible). `seabed-scene.js` builds the floor, rocks, weed, scatter and wrecks as geometry; `gl/seabed.js` draws it with the water behind it. It was reported as "the land cuts off in front".

- **The water's colour is a function of the view ray.** `waterAlong` (GLSL in `gl/seabed.js`, a JS twin in `seabed-scene.js`) is lighter looking up and darker looking down. The backdrop is that colour, and the floor, its props and the bubbles fog toward it along their own ray, so whatever dissolves lands on exactly the colour behind it. The backdrop used to be a screen-height gradient while the floor fogged to one flat colour, nearly twice as bright as the water behind it near the horizon, so the far edge of the floor showed as a line.
- **The patch is 30 tiles and banded.** A quarter tile to 6 tiles, a half to 14, a whole tile to 30 (`GRID_AXIS`), the idea `water.js` uses for the surface. Every band edge is a whole tile, so the coarse lines land on the same world positions after each rebuild. Rocks, weed and small scatter stop at `SEABED_NEAR_R` (12); wrecks and the kinds in `SCATTER_FAR` go to the edge.
- **Extinction is `SEABED_EXT`**, 0.33 of the surface's per-channel curve: a third of the floor's colour left at ten tiles, dissolved between `SEABED_FADE` (17 and 28.5 tiles). The other layers (hulls, pier legs) fog linearly in world.js's band to `SEABED_FOG_FAR`, where the floor's green is down to a tenth, toward the horizon colour.
- **Dry land in the patch isn't drawn.** It has depth 0, a flat sheet level with the surface, and from below it read as a sand ceiling over the city.
- **Cost.** A rebuild on a tile crossing is 22 to 32 ms over the Coldwater coast, the same as the 12-tile patch was. Most of the old cost was pushing vertices onto a plain array and copying it; `triS` writes straight into a `Float32Array`. `wreckInCell` rolls its dice before the 48-ring shore search: the chance never passes `WRECK_MAX_CHANCE`, so a roll over it is no wreck at any depth. Same answers, checked over 644 queries, at a fifth of the time.

## Wet glass after surfacing

A dunk lasts under a second, and without something left on the glass it reads as a glitch. No new code draws it: the file already has thirty beads with life, run, gravity, a slipstream flatten and a wiper, gated on rain or storm weather. A dunk opens the same branch.

This is state, which the rest of the sea avoids. The surface is a pure function of position and time because two clients and a server must agree on crests. Water on the lens isn't the sea; nothing reads it back, verifies it or derives from it, so it may remember things (the foam trail's argument).

The beads are seeded heavy and already running. A rain bead starts at full life and must grow heavy first (`life` falls about 0.01 a frame), so seeding it the rain way showed nothing for twenty frames and only ran at sixty. Measured: 1.16% of the frame at surfacing, 2.93% at 1.3 s, 0.95% with a peak of 22 at 7.3 s.

Trap: scene state is cached on the canvas id, so an A/B run twice on one canvas lets the flag-off run inherit the flag-on run's wet glass (the stale-foam-trail trap). It read 0.00% at every delay until each run got its own id.

## Bench clock for temporal events

`clockMs` on `__glSeaShot`. Every bench pins the clock, which suits anything measuring a pose. At the default instant the shot position is in a trough, and no offset inside a valid map box puts the eye under. The dunk is a temporal event, so the instant is a parameter (as `snowForce` is a depth). Sweeping the clock found the deepest instant for the helm seat: 0.296 tiles under at `Date.now = 1750000743600`.

## Street lamp pools

`RENDER_TUNE.glPool` (0 is the street as it shipped in clear air; see the dry-night note below). Reported as lamps looking like a harsh ball rather than a gradual cone.

Lamps lit nothing on the ground. Everything else a light does to the ground in GLASS is specular (the wet streak in `ground.js`, the glint, the mirror) and gated on water, so on a dry night no term put lamp light on the tarmac. `uPool` is the diffuse half. It uses the same six lights the wet road already ranks and uploads: the specular terms ask what bounces at your eye, this asks what lands on the surface. So a lit doorway spills onto its pavement and a neon sign washes the road under it, with nothing new collected or authored.

It isn't the wall wash turned over. That one has been reverted five times (`LIGHT_TUNE.gain` is parked at 0) because a wall is the subject of the shot and a light across it drowns its lettering. Tarmac has nothing on it to drown.

- **Shape is irradiance.** A point source at height h over a plane gives `cos θ / r²`; normalised to 1 beneath, `h³/(d² + h²)^1.5`. It has no edge: 0.35 of peak one lamp-height out, 0.014 at four times that, so it needs no cut-off.
- **Height is the light's own.** `uWetP[i].z` is already uploaded and the wet streak reads it (*"a sign three storeys up throws further than a kerb lamp"*), so a street lamp lays a pool about its own height across and a floodlight a broad one.
- **Height has a floor.** A light on the ground has h ≈ 0 and `h³/r³` at d → 0 is a singularity: a white pinhole.
- **It adds into the headroom.** `c + k` would saturate a painted line long before the tarmac beside it, leaving a white bar across road markings.

## Glow radius floor and lamp halos

`glowPool` draws `clamp(s0 / f, 3, 60)` pixels, so past four tiles a lamp stays at three pixels while its peak alpha stays the same. At sixteen tiles the disc covers sixteen times the area it should, at full strength. A building glow survives that; street lamps come in receding rows, so a dozen land within a few pixels and composite into one saturated blob over a dark road. The alpha now carries what the radius can't. It's floored rather than taken to zero, because strict conservation puts a lamp at sixteen tiles on 6% strength and a far street light should be visible.

The peak came down too (`LAMP_HALO_A`): `0.42 + night·0.4` was 0.82 at midnight against 0.70 for the brightest building glow, on the one light drawn twenty to a street.

With the pool on, the lamp's second disc is gone. It sat at z 0.01 as a screen-space circle standing in for light on a plane seen nearly edge-on, which is exactly the reported shape. Keeping it would give two owners of one pool, and it enters the light list at ground height, where only the irradiance floor stops the pinhole. At `glPool` 0 it returns, so the 2-D fallback (no shader pool) is unchanged.

## Ground shader lights on dry nights

A separate fix in the same commit. The light list was handed over only when `opts.wet > 0`, so a clear night uploaded `uNWet` 0 and every loop in the shader broke on its first iteration. Reflections didn't care (they're gated on `refl`, `uWet` times a coverage, 0 when dry), but two non-water terms died too: the pool, and the volumetric light shaft, which is gated on haze. So fog without rain had no light cones, with a slider, uniform and loop all correct. Turning `glPool` off deliberately doesn't restore this, so that's the one place the flag's 0 isn't the shipped renderer.

## Measuring the pools

`__street` can't measure it: it freezes no clock and pins no dial on purpose, so it's for the picture only. An A/B of the gain there had the control moving 5.47% against an effect of 3.93%.

`__glPool()` in the Modelshop is the number; its control reads 0.00%. The frame moves 0.09% at gain 0.4, 1.46% at the shipping 1.2, and 4.17% at 2.4. The road's flatness (share of pixels within eight levels of each other) holds at 58–62% throughout, so the pools stay pools. `peak` stays at 71 from 0.4 to 1.8 because the term adds into the headroom: a gain that raises the peak without raising `moved` is growing the ball back. The 13:00 rows read 0.00% at every gain, the control that matters: the list has no night term, so `uNight` is the only thing preventing the wall wash's pink-cast-at-midday bug.

Trap: `glbench`'s synthetic street has a white blob at its vanishing point even with the lamps deleted, and it was mistaken for the reported ball for most of an hour.

Trap: every lamp in the baked flight snapshot is off. `sl` comes from `furniture.light_on`, which the content import leaves at 0, so 84 lamp posts render unlit; `__street`'s `cells` patch lights them for a frame.

Gate: `npm run gl:pool` ([scripts/shapes/lamppool.mjs](../../scripts/shapes/lamppool.mjs)), in the `pretest:regress` chain and in `shapes:smoke`, mutation-tested 13 of 13.

## Lightning channel

`RENDER_TUNE.boltDetail` (0–1); `boltForce` is the bench seam. The server is still the single strike authority (`stormTick`); everything downstream changed.

There were three generators: windshield.js had one for the world channel and one for the on-glass channel, and hangar-ambience.js one for the doorway, each a nine-ish-node zigzag with its own jitter, width and colour. Now there's one channel in `client/shared/lightning.js`, one painter in `lightning-draw.js`, and three readers that differ only in projection.

The channel is recursive: four generations, ~20 branches, each thinner and fainter. Rules that stop it reading as a bush:
- A branch takes a bearing away from its parent and holds it. Re-jittering about the vertical gives every fork the trunk's shape.
- A child whose bearing points back at the channel is mirrored about the axis. A pure rotation turns half of them round so the tips hook home, which reads as legs.
- A branch stops in the air. Left to ground freely it's 4.7 arrivals a bolt.
- Hitting the floor ends the branch. `f <= 0` used to clamp it, so it carried on at constant height and projected to a hard white bar across the road.

Brightness is a restrike schedule: a return stroke and two or three more up the same channel. Later strokes barely touch the side branches (they belong to the stepped leader), so the channel stammers while the tree fades once. It's rolled at birth and deterministic; the old one multiplied by a per-frame coin flip, so a fast machine flickered and a slow one didn't.

The channel starts at the cloud deck. `topZ` was `max(3.5, cam.EH + 1.5)` against `cloudBaseZ('storm')` of 5.66, so channels began below the deck and were shorter than a thirty-storey tower (5.9 tiles), reading as a spark between roofs.

## Lightning draw order

Additive white can't exceed 255 before a wash, and the channel was drawn inside the world block with `applyStormGrade`, the fog wash, the G-grey and the truck's headlamps-off wash (`rgba(6,8,14,0.62)` over the whole world) all after it. In a real cab frame the hottest channel pixel reached luminance 102 against a night sky of 15. Drawn after them it's 255.

The headlamps wash exists so a driver without lights can't see far, but lightning is visible without headlamps. The flood was already drawn after the grade, so the strike's light escaped the murk while its channel didn't. Both are now one block after every grade and still under the glass (cab trim, windscreen post, dash and water on the pane are in front of you). The flood goes first and the channel over it, or the channel loses half its contrast to its own light.

It's banked through `bankInto`, a named closure with two callers, because a second hand-written copy of the transform could get the shudder or bank sign wrong unnoticed. `cam` is passed forward in a local (`boltCam`, the `CAB_CAM` idiom) because it's built inside the world block and the bolt is now drawn after it.

## Lightning scene light

Three additive lights under the channel, all on the same envelope:
- **Area:** a broad pool centred on the channel. Its radius is a world reach through the lens (`BOLT_LIGHT_TILES`), never pixels: a strike two streets away lights two streets, where a fixed disc lights the whole frame and reads as a filter. The flat flood dropped 0.5 → 0.3 when this arrived, because the two together blew a night street to white. The flood remains for strikes outside the frame, which is most of them.
- **Ground:** a pool on the ground plane, its ellipse solved from four projected points. Its flattening is capped, deliberately not physical: an eye 0.12 tiles up looking ten tiles out sees 1.1 px of height against 100 px of width, which draws as a bar. What's drawn is light scattering in the air above the contact.
- **Cloud:** lit from inside as a cluster scattered off the bolt's seed, because concentric circles read as a lamp in the overcast.

None of them uses `glowPool`. It gates on `ADORN_TIER` and `POWER_DUTY`, frame state left by the last building drawn, so a bolt after a blacked-out tower would be switched off by the power grid, and its canvas path goes through a queue flushed with the world pass two hundred lines earlier.

Gate: `npm run gl:bolt` ([scripts/shapes/bolt.mjs](../../scripts/shapes/bolt.mjs)), in the `pretest:regress` chain and in `shapes:smoke`: 22 claims, mutation-tested 14 of 14.

Trap: its ordering claim reads raw source (other scans blank comments first) because `blank` wipes a template literal whole and the wash it looks for is one. So every anchor is a call with its arguments, never a function name.

Trap: two claims first tested themselves. The outward rule was "did the branch end further out", which branches do anyway (1.6% against 6.0% with the rule off, needing a threshold too loose to flake). The one-envelope rule counted `boltBright` readers, which survives the flood growing its own sine because there are three.

The picture is `__glBolt()` in the Modelshop and the number is `__glBoltLum()`. `__glBolt` crops rather than rendering bigger (unlike `__glSeaShot`) because `paintWindshield` sizes its backing store from `clientWidth`, so 2× CSS width gives the same picture. `__glBoltLum` needs a control frame with the strike pushed past `BOLT_MAX_DIST`, because the brightest pixel in a storm frame is usually a lit raindrop or the weather badge.

## Storm sea floor

Reported as weak waves in storms. The sea's target is `Math.max(live wind in knots, stormSeverity × SEA_FULL_KT × K)`: wind drives the sea and the storm grade raises a floor. But the day's wind comes from a climate profile's `monthly_wind_kph` (all authored profiles are 10–22 kph), `windFromView` converts at 0.54, and nothing in environment.js added a storm term. Live wind topped out near 12 knots against a floor of 31, so the `max` took the floor every frame and K did all the work. At K = 0.7 the worst weather asked for 31.5 of a 45-knot scale: Hs 2.79 m, tallest crest 1.96 m. At the full scale it's 3.99 m and 2.82 m, which matches what section 21's hydro launch was already tuned against.

It's still a floor and a `max`, so a weather-aware wind restores the original design and a windy clear day can still exceed it. Section 23 of `sea.mjs` reads the fraction from the source and fails if one comes back, with a ladder control (crest 0.11 → 0.20 → 0.29 → 0.39 tiles across quarter-severity steps), because clamping every storm to the top would pass the first check and make every grade produce one sea. Mutation-tested.

## Weather-aware wind

This was first recorded as "the game's wind is weather-blind": `windKph` is read by wind chill, the audio wind bed, NPC banter, windsocks, flags, rain slant, spindrift and the sea, and it reaches `apparentTemperature`, making it a gameplay decision.

Half of that was wrong and the other half is fixed (2026-09-27). The day's wind was never weather-blind: the weather plugin's `WIND_BY_WEATHER` doubles it on a storm day. It was blind to the live field: one figure for 24 hours whatever cell was overhead. `getZoneWindKph(zoneId)` / `getWindKphAtGrid(x, y)` in environment.js scale the day's wind by the tile's `stormIntensity` (×1.85 at a cell core) and `precipRate` (×1.25), putting a storm day's ~46 kph at ~85 under a cell (about 46 kt). Wind chill, clothing wetness, the zone snapshot the client renders from, the ambience wind bed and the flight sim's sky push read it; the HUD and forecast keep the day's headline. It can't feed back, because severity derives from the forecast wind.

Gusts: `client/shared/wind-gust.js`, `RENDER_TUNE.windGust`. A zero-mean speed multiplier and direction veer off the wall clock, scaled by how stormy the sky token is (±12% and ±6° quiet, ±45% and ±22° in a squall), so two clients see one gust. `windFromView` applies it and the cockpit flight model uses the same function. That replaced a private sine on the client clock plus a `sev * 13` kt weather baseline, which double-counted a storm once the sky push carried live wind.

Trap: every windsock pointed 250° and flew 1.85× too hard off the cockpit. They read `v.windVec?.dir ?? 250` (set only when airborne) and treated `v.wind` (kph) as knots. They read `windFromView` now.

Gate: `npm run gl:wind`, in both lists.

## Forward-leaning waves

`SEA_SKEW` 1.4, `SEA_ASYM` 2.0 in sea-swell.js. Reported as waves not breaking over.

- **Skewness** is vertical: sharp crests over broad troughs. The sea has had it since the Stokes term shipped.
- **Asymmetry** is horizontal: the front face steeper than the back, crest pitched forward. It's what reads as about to break. Measured before this change, asymmetry was −0.003.

The two are the same harmonic in quadrature (skewness on `cos 2θ`, asymmetry on `sin 2θ`), so the lean costs one sine per train. Both scale with `kA` because the second-order Stokes correction is proportional to steepness: a glassy sea is symmetric by arithmetic and a gale leans because it's steep. A flat offset would pitch a dead calm forward. `SEA_SKEW` is a gain on the nonlinearity, never the height: a wave nearing breaking moves energy into its harmonics at the same total energy, so JONSWAP still owns Hs. Measured: crest 2.74 → 2.86 m, Hs 3.99 → 4.06 m, with the shape changed completely.

True breaking over can't be reached. A breaking wave is multi-valued (the lip is over the trough, so one (x,y) has three heights), and the sea is `seaHeight(u, v, t)`, single-valued. Four readers ask "what's the height at this world point": the floor shader (which recovers a world point from the screen), the mesh vertex shader, the hull's ride, and the gate. A true Gerstner wave is parametric and would need an inversion, and it folds past ka ≈ 0.5 (the cusped-shoreline bug `coastWarp` already shipped once). So the lean is vertical: it can pitch a wave forward and never overturn it.

Gains were swept against face angle. The Stokes limiting wave has a 120° crest (a 30° face), and the shipped sea already peaked at 30.8° because a superposition exceeds any single train. At skew 1.4 / asym 2.0: vertical skewness 0.178 (observed seas +0.1 to +0.3), horizontal asymmetry 0.483 (observed 0.5 to 1.5), steepest face 34.8°. Asymmetry saturates near 0.6 (2.0 → 3.0 buys 0.51 → 0.60 for three degrees of face), so there's nothing above worth taking.

The derivative was written out at seven call sites (four JS, three GLSL), each a chance for the lighting to describe a different surface from the geometry. It's one `stokesD`/`seaStokesD` now. The "analytic slope is the slope" claim catches a mismatch: dropping the lean from the derivative alone fails at 8.02e-4.

## Foam on the crest front

`SEA_FOAM_LEAD`. Whitecaps threshold on the chop (three plain sine trains with no Stokes term), so they sat symmetric about crests that now lean.

- The amount can't change, only where it lands. The threshold is quantile-inverted to Monahan & O'Muircheartaigh's observed coverage, so biasing the test would foam the wrong fraction for the wind. Shifting the sampling position moves the pattern and leaves the distribution alone.
- It's a second sample, not a shifted `wv`, because `wv` also drives surface shading and moving it slides the lighting off the geometry.
- It's read off the chop, never the whole surface, or the mask inherits the swell's 8.6-tile period: bands of whitecaps marching across the bay.

Section 24 of `sea.mjs` gates all three, mutation-tested 5 of 5.

Trap: a `const float` declared inside `SEA_GLSL` is invisible to any shader including it via `${…}`, because `gl:glsl` cuts interpolations before scanning (correctly, since names inside are JavaScript). The answer, as for the sidebands, is to interpolate the JS value, so there's one number.

Trap: two heredoc-mangled regexes went in with it. A regex with its escapes stripped is still valid and matches nothing, so section 23's `SEA_FULL_KT = (d+)` took its fallback of 45 and passed against a number it never read.

## Modelshop serves a stale glbench.js

The Modelshop server caches `glbench.js` in memory. It once served 206 KB against a 305 KB file on disk, with `window.__glSeaShot` absent and no error. Restart it (`npm run modelshop`) after editing a bench; if a bench on disk is `undefined` in the page, check the served byte count first.

## Crest spray

`RENDER_TUNE.glSeaSpray` (0 is the sea as it shipped). Spindrift already existed and is different: foam already torn off and dragged downwind along the surface, in the water fragment shader above about Force 7. This is water thrown into the air as a crest collapses. Measured: 0 droplets below sea state 0.5, then 14 / 28 / 70 / 154 up the scale, and 0 with the flag off.

- It's arithmetic, not a particle system (the flocks' rule): a puff is a pure function of its site and the wall clock, nothing stored or stepped, so two clients see the same spray. A droplet lives under a second, so an emitter would buy nothing.
- It breaks where whitecaps break, off `seaFoamThreshold` (the chop's quantile at Monahan's coverage). A second criterion would put droplets over unbroken water.
- It can't go through `pushLight` (the `shippingOn()` trap a third time). That funnel opens with `if (POWER_DUTY <= 0) return`, and `POWER_DUTY` belongs to the last building drawn, so spray would vanish over open water whenever the previous tile was a blacked-out tower. It writes to the sink itself.
- It's emitted beside the ground pass's dressing, with the sinks armed. Emitted earlier, it reaches a null sink and paints on the canvas over the composited city (`emitGroundLate`'s bug).
- Site count isn't the dial. At 22 sites in a full gale exactly 2 broke, which is 9%, Monahan's Force 9 figure. The sea was under-sampled, so the fix is more drops per crest and more sites.
- A droplet is a puff, not a point. At `2.2/f` a drop three tiles out is 0.73 px and clamps to the floor, so the burst rendered as single-pixel specks.

Section 25 of `sea.mjs` gates the four silent failures, mutation-tested 4 of 4. The picture is `sprayTally()` on a painted frame, since no headless harness reaches a sprite.

## More wave components (reverted)

32 components were built, measured and reverted. Built as a generated 13+14 sideband fan (the directional-spread claim refused a first golden-angle fan that put sidebands on the peak's heading). Per-fragment transcendentals went 26 → 95 and per-vertex 22 → 91, a 3.65× cost this machine can't resolve (`__glSeaCost` at 2560×1440: 0.63 / 0.10 / 2.67 ms against a 5.59 ms spread). The picture barely moved: the band carries only 7.4% of the swell's energy and 6.0% of the wind sea's, so the peak keeps 96–97% and each of thirteen components is worth 1–13 cm against a 1.05 m peak swell, mostly smaller than the chop (14 cm), which is itself only a normal map past six tiles.

The lever is the band's energy share, not the count. Raising it flattens the crests (Stokes correction goes as amplitude squared; measured 0.154 → 0.087 last time the peak's share dropped, and the compensation built then covered a different bug). A real spectral widening means rebalancing and retuning the nonlinearity, judged on screen.

## Hydro seat

`plugins/powerboat`, `client/game/js/panels/boat-view.js`. The race boat had a hull, a flight model and a sea, but no inside seat. It follows the cab's shape: windscreen, wheel, lever and a text rung.

- **One geometry inside and out** (`client/shared/boat-house.js`). The pilothouse from inside and outside were two hand-written station sets with windows in different places. One module owns the hull stations and house curves; `aircraft3d.js`'s `buildBoat` and `interior-shell.js`'s `boatProfile` both read it. The exterior mesh is byte-identical to the pre-move one (sha256 pinned); re-run that check after any refactor. The scale bridge is `mPerUnit = eyeM / eyeZ`, stated once: tiles-per-unit cancels, so an eye height in metres and a hull in tile units meet at one expression.
- Trap: `SHELL_PROFILES` evaluates profiles at module init, so a `const` one uses is in its temporal dead zone. The boat profile is a memoising getter.
- **Trim is `1 + k·trim`.** Neutral trim reproduces the shipping handling exactly (`Object.is`), so the tabs cost nothing on untouched boats (like `calibration: 100` for chrome).
- **The text rung is `conn`.** It's something you act through, so it's `prefersTextMinigames`, never `prefersLoggedPanels`: deleting the wheel would leave you stuck in a moving boat. Bells are words (`stop`/`slow`/`half`/`full`/`flank`). The bearing controller's gain is `err / max(6, turnLock · dt)`; a fixed gain hunted (19 overshoots on `slow`) because rudder authority depends on the bell. `steerFor` is exported so the gate measures the controller itself.

Six controls were wired to nothing, each correct-looking at the call site:
- `onHold`/`setAngle` aren't in the wheel's API (`setAccent setHeld setDragging wind setEnabled getAngle getLock destroy`), so keyboard steering did nothing.
- `dispatchAction('BOAT_BREAKUP', {…})` takes one object and returns `Unknown action: undefined` rather than throwing, so a wreck was a silent no-op.
- The weather hand-off sent `ground` where the renderer reads `wxGround` (the `gl:snow` hand-off trap).
- `rampV8` reads `{rpm, pedal}` and was given `{load, nitro, airborne}`, with the pedal passed as rpm.
- S was bound to an astern term `stepBoat` doesn't have.
- `boat_sim_close` had no sender, so ESC cleared `aboard` and left the seat open.

Trap: handlers are `(args, raw, player, broadcast)`, and one was written `(player, args)`. It passed a 10,051-check suite because the case only asserted a refusal, and a handler reading a player object as an argument string does refuse. A check must seat the helm and assert the bearing moved.

## Hydro HUD wheel

The 2-D HUD wheel was the Echelon's round rim, while `wheelFaces` in interior-shell.js has drawn a butterfly with shift lights in 3-D since the pilothouse shipped. `art: 'f1'` is now the HUD view of the same object.

- A ship's wheel is round because it's geared several turns lock to lock and your hands travel round it. A race boat is under a turn (`lock: 0.5`, ±90°) and your hands stay on the grips, so the top and bottom of the circle are dead weight.
- The waist makes the shape. A first cut with flat top, flat bottom and straight sides read as a games controller.
- Grips must be lighter than the face (`feedback_detail_parts_need_own_palette`): in the same near-black carbon, the silhouette had no handles.
- The shift strip reads `st.sim.rpm` (the crank), never `pedal`. A caller with no `getRevs` gets no strip, so the truck and yacht wheels are unchanged.
- No strobe at the limit (the drug-FX rule). A first full-width flash at 0.55 alpha buried the lamps; it breathes at 0.16 behind them.
- The centre readout counter-rotates (the chess set's trick), or it's upside down at full lock.

No headless gate can see these. `scripts/client/boatseat-smoke.mjs` mounts the seat, paints it, checks packet arity against the server's own unpack and builds all four marina tabs, and a plausible wrong wheel passes all of it. The instrument is a scratch page served from `client/` as web root with the widget mounted three ways (centred, at lock, truck art as control), the `reference_fsim_layout_harness` idiom. Both defects above were found only by looking.

## Torn foam

`RENDER_TUNE.glSeaTear` (0 is the smooth threshold as shipped). Reported from the air as whitecaps like soft glowing blobs in rows. Measured, foam patches had a perimeter 1.25× that of a round disc of the same area. `cap = chop > threshold` on a smooth field can only give smooth-edged islands, so no threshold tuning could fix it. After: raggedness 19.6 → 24.3 with coverage intact; control 19.60 against 19.61.

The tear goes into the field, not the finished mask. Eroding the mask with noise would foam a smaller fraction than the wind says while the gate stays green (it checks the threshold, not pixels). `seaFoamThreshold` is the quantile of the field the shader tests, inverted against Monahan & O'Muircheartaigh's whitecap fraction; perturbing the field and re-quantiling preserves coverage (tracks Monahan to ~1% at 10/22/34/45 kt). So the quantile is per tear gain (capped at four entries, quantised to 0.02; each is 65,536 doubles and the gain is a slider). At flag 0 the shader tests the smooth chop and must get its quantile, or the off switch changes how much sea is breaking.

The core stays solid: `cap` ramps from the threshold, so deep in a crest the mask is far past 1 and the perturbation does nothing, while at the rim it decides. Noise multiplied into the final alpha would punch holes and read as dither.

Amplitude is set against the field's gradient. A perturbation moves the boundary by `amplitude / |grad chop|`, and that gradient is 2.43 per tile. The first cut's 0.16 moved the edge 0.066 tiles against a 0.29 crinkle period, which measured as no change. Too fine is equally invisible: at 90 rad/tile the shift exceeded a whole period and folded into sub-pixel noise. It ships at amplitude 0.40 and 42 rad/tile: a 0.15-tile crinkle displaced 0.066 (ratio 0.44), the ragged regime. All three look smooth in a screenshot.

## Two foam populations

Monahan & Lu (1990): Stage A is the actively breaking crest (about a second, dense, bright, along the crest); Stage B is the patch it leaves, living five to ten times as long, spreading and dimming, and covering 1.5 to 40 times the area of active crests at any instant. The mask had one population and one brightness.

- The ramp was `×9`, crossing 0 to 1 in about a tenth of the chop's range, so nearly every foam pixel saturated into a flat slab. It's `×3.4` now, clamped, with the upper ramp as Stage A.
- The stages are nested (the active core inside its patch), so the thresholded region is still Monahan's fraction and only the shading across its depth changes.
- Stage B is a desaturated blue-grey, since decaying foam is a thinning raft of bubbles with water showing. White would just enlarge the slab.

Whitecaps are streaks. The chop is near-isotropic, so thresholding gives round islands; a wave breaks along its crest. The shader already biased foam onto the wind sea's long crest lines, but the bias wasn't zero-mean and added coverage above the quantile (despite a note claiming "the same number of white pixels either way"). Centred on 0.5 it redistributes, and elongation follows. The tear's frame is stretched along the crest by `SEA_FOAM_ALONG`. That stretch can live in the shader alone: rotating and scaling a stationary field changes correlation lengths but not its marginal distribution.

## Foam quantiler accuracy

The quantiler had badly estimated its distribution since it shipped. At N = 8192 there are eight samples above the 0.1% quantile, and the lattice used one multiplier per axis off the same index, walking a line through the domain so whole regions were unsampled. Against 400,000 fresh samples the sea foamed 0.050% where Monahan says 0.102%, and 0.92% where he says 1.51%. At N = 65,536 on an R2 low-discrepancy lattice it's 0.103% and 1.500%, and the suite's figure went from 1.49 points to 0.12. It hid because the check was in points: a factor-of-two error at 22 kt is 0.58 points, under a 2-point bar. The gate now has a relative bar too; mutation testing shows a 51% error is caught.

Traps in this feature, all silent:
- The amplitude was applied twice: `SEA_FOAM_TEAR × tune` in JS, then multiplied by `SEA_FOAM_TEAR` again in the shader (0.16 × 0.16 = 0.0256, a two-centimetre edge). The gate checks the return's shape (`return amt * seaFoamTear(q, t);`), because a mutation writing a bare `0.16` passed a check looking for `SEA_FOAM_TEAR`.
- The ramp and two stages went in unconditionally, so flag 0 left foam dimmer and differently coloured than shipped. An off switch that doesn't switch off corrupts every later A/B.
- A flat calm's threshold was a hardcoded 1.2 meaning "above the field's max", and the tear widens the field, so glass mornings grew whitecaps. It's derived from the samples now.
- The coverage gate sampled the smooth chop against the torn threshold (reporting 2.0 points at 55 kt from its own mismatch). It checks both settings against their own fields now.
- Two gate checks couldn't pass: the tear-spent-once check sliced `seaFoamTorn` backwards (bounded by `seaChop`, declared above it) and came back empty; and its regex lost its backslashes in a heredoc, becoming `/return amt * seaFoamTear(q, t);/`, valid and matching nothing. Both "caught" every mutant by always failing. Use the Write tool for anything carrying a regex.

## Far-water whitecaps

`floor.js` used absolute whitecap thresholds (`wv > 0.90`, `wv > 0.86`) without the Monahan inversion, so the sea beyond the 14-tile mesh patch foamed on a fitted constant. In the diagnosed frames `glSwell: 0` left 0% bright pixels, so visible whitecaps were the mesh's, but that wasn't guaranteed. Fixed 2026-09-27 (`RENDER_TUNE.glFoamFar`): the floor and its 2-D twin test `seaFoamThreshold(kt, 0)`, the tear-0 quantile of the smooth chop they draw, with the noise mask off the whitecap. `sea.mjs` section 30 holds it to Monahan within 3.7% at 12–45 kt.

## Whitecap size

`seaFoamFine`. Reported as foam still blobby after the tear. Patch size and edge raggedness are separate: a patch is a level set of the thresholded field, so its size comes from that field's wavelengths. The foam was tested on `seaChop` (trains of 1.09, 1.20 and 0.60 tiles), so every whitecap was a four-to-eight-metre island.

More tear doesn't fix it. A connected-component census at six times the shipping tear: patch count 43 → 122, largest only 2454 → 755 px, median collapsed to 6 px. Noise shatters small patches into speckle and leaves big ones. Perimeter/√area rises throughout that sweep, so the raggedness metric alone would endorse cranking the tear.

Whitecaps come from short breaking waves, so the foam test gets two real trains at about 0.25 and 0.17 tiles (1.8 and 1.2 m), added to the foam test only. On an air frame at 45 kt: 43 patches (mean 224 px) became 80 (mean 69), largest 2454 → 1149, median 38 → 10, with no speckle collapse and a bit-identical control. Frequencies come from the dispersion relation (ω² = gk, g read off the chop's trains at 0.141 in these units) and are snapped to the 0.01 rad/s grid, or `seaClock` loses phase-exactness and every client gets a foam seam every ten and a half minutes.

These trains must never reach the surface. The mesh carries 5.4 samples across the shortest chop train and can't resolve 0.17 tiles, and a fragment normal describing a wave the geometry doesn't draw is forbidden. `gl:sea` walks `seaRoll`, `seaWind`, `seaSlope`, `seaChop` and `seaHeight` and fails if any mentions it. It also rides the tear's switch at both ends (`step(uTear)` in the shader and the same gain in the inversion), since gating one only gives flag 0 a threshold for a field it doesn't test. Mutation-tested 3 of 3. Trap: one of the three claims couldn't pass on the clean tree at first (a 900-character window overrun by the comment block inside `quantiles`).

## Bigger storm seas (101 m swell)

At the top of the scale the sea was Hs 4.06 m, crest 2.97 m, trough-to-crest 5.57 m: WMO sea state 6 ("very rough"; 6 starts at 4). A real storm is state 8 at 9–14 m. This step made it Hs 6.52 m, crest 4.64 m, trough-to-crest 8.72 m: state 7 ("high").

- **The ceiling was the fetch.** JONSWAP puts Hs on `sqrt(FETCH)`: 50 km was worth 4 m at 45 kt, 130 km is worth 6.5. Raising `SEA_FULL_KT` instead would need 73 kt and would move a number eight other systems read (wind chill, audio bed, windsocks, flags, rain slant, spindrift, NPC banter, `apparentTemperature`). Fetch only means "how much open sea beyond the map".
- **A tall wave must be long.** Limiting steepness is H/L = 1/7, so the old 60 m train could carry 8.6 m and was already at 64%. Past `SEA_KA_LIMIT` (0.443) the second-order term overtakes the fundamental and the crest notches. The dominant train went 60 m → 101 m; steepness 0.092 → 0.086 (64% → 60% of the limit).
- **The wind sea lengthened too.** Amplitude splits 60/40 and rises with Hs while k doesn't, so on its old 22 m wavelength at Hs 6.5 m it would hit kA 0.610. At 38 m it's 0.357, gentler than its old 0.381.
- **Frequency first.** ω is snapped to the 0.01 rad/s grid and k derived from it, because `seaClock` wraps at 2π/0.01 and a free ω puts a seam across every client's sea every ten and a half minutes. ω 0.31 → 0.24, k 0.7272 → 0.4357 through ω² = gk, with g from the train's old pair.
- **Sized to the patch.** `PATCH_R` was 14 tiles and the new train 14.42, one whole wave across the displaced mesh. A real Hs 12 m sea has a 14 s period and a 306 m (43.7-tile) wavelength, three times the patch, which draws as a tilting slab beside the flat floor.

Knock-ons:
- The hull's worst gale attitude went 11.1° roll / 11.0° pitch → 9.0° / 7.7°, because the fitted plane follows slope (H/L), which fell. She heaves 0.425 tiles (3.0 m) over six seconds. No retune; effective-slope coefficient unchanged.
- The hydro launches 13.5 → 8.5 times a minute at the same 0.032-tile peak, because a long swell is a gentle rise and short chop is what throws a boat. `launchVs` isn't retuned: the launch speed is the kick, so a lower bar only buys more negligible launches (at 0.03 it left the water 357 times a minute and never cleared 0.011 tiles). More air needs more chop.
- `seaSlope` keeps its own copy of the peak terms, and moving `seaRoll`/`seaWind` left it describing the old 60 m wave. `gl:sea`'s "analytic slope is the slope" check caught it. Its `0.540 * cA` / `-0.405 * cA` constants are `SEA_PH`'s wavenumber times the wind train's `pm` and must not move with the train; only the ku/kv in front change.
- `sea-audio.js` derives its LFO rates from `SEA_ROLL.w`/`SEA_WIND.w`, so the bed now breathes at 26.2 s and 16.1 s (was 20.3 and 12.3) with no edit, and `scripts/audio/sea-smoke.mjs` stayed green. Only comments quoting the old periods needed updating.
- A low camera is under the surface 36.3% → 41.6% of the time at 45 kt, ducking up to 4.29 m. The dunk shader and wet glass handle it.

## Sea headroom at the 101 m wavelength

The limiting wave at 101 m is 14.4 m trough-to-crest; the sea sat at 8.72. Sweeping fetch with everything else fixed:

| fetch | Hs | trough-to-crest | % of the limiting wave | steepest face | sea state |
|---|---|---|---|---|---|
| **130 km (shipped)** | **6.52 m** | 8.72 | **60%** | 35.8° | 7 high |
| 200 km | 8.17 m | 10.99 | 76% | 42.9° | 7 high |
| 300 km | 10.14 m | 13.77 | **95%** | 50.1° | 8 very high |
| 450 km | 12.66 m | 17.34 | **120%, impossible** | 57.7° | none |

Hs 10 m is inside the limit but its 50° face (against Stokes' 30°) reads as a sawtooth. The practical ceiling at 101 m was about Hs 8 m (76%, 43°). Past 100% the crest notches, so the 450 km row is broken.

Holding steepness at 60% of the limit, the wavelength needed is `9.36 × Hs`:

| want | needs a wave of | in tiles | against `PATCH_R` 14 |
|---|---|---|---|
| Hs 6.5 m (high) | 101 m | 14.5 | fits, exactly one wave |
| Hs 9 m (very high) | 140 m | 20.0 | 1.4× |
| Hs 12 m (very high) | 187 m | 26.7 | 1.9× |
| Hs 16 m (phenomenal) | 249 m | 35.6 | 2.5× |

The grid can't be coarsened to pay for it: the 0.60-tile chop needs about five samples, so `PATCH_PER_TILE` can't drop below 9 inside `glSeaChopR`. A uniform 14 → 28-tile patch is 64k → 254k vertices (4×).

Cost was unresolved on this machine. Through `__glSeaShot` at 1280×720, PATCH_R 28 measured a 77.3 ms median against 129.2 for PATCH_R 14, with overlapping spreads (67–172 and 77–172): scene-build noise. `__glSeaCost` puts the whole sea at 0.16–0.23 ms against a 2.06 ms spread. The vertex count is the deterministic figure; a real answer needs a bench timing the patch build and draw alone with dials pinned.

A uniform grid is the wrong shape anyway: chop is displaced only within `glSeaChopR` (6 tiles), so at PATCH_R 28 about 95% of 254k vertices would carry only a 101 m wave needing about one sample per tile. A graded grid (dense at the eye, coarse at the rim) buys the radius near today's count.

## Graded sea patch (state 8)

Built: `PATCH_R` 14 → 28, `PATCH_FINE_R` 6, `PATCH_RIM_STEP` 1.4. Hs 12.0 m, crest 8.62 m, trough-to-crest 16.1 m: WMO state 8 ("very high"). The tables above are superseded in their numbers but the order held: the patch had to grow before the wave could lengthen, and the wave had to lengthen before it could get tall.

- Uniform at 28 tiles would be 504 divisions a side, 254,000 cells. Graded, it's 19,348 cells, against 63,504 for the old uniform 14-tile grid (measured through `window.__seaPatch`).
- Division counts are derived: the fine zone owes `PATCH_PER_TILE` for the chop, the rim owes `PATCH_RIM_STEP` for the wind sea. A hand-sized grid goes wrong when either moves.
- Grading is separable, so the fine zone is a square (reaching 8.5 tiles where it owes 6), which avoids T-junctions without stitching.
- `PATCH_FINE_R` must never be below `glSeaChopR`, or a 0.6-tile wave is displaced in cells too coarse for it: torn geometry, silently, since the lighting still describes a smooth wave.
- The knee is a 12× spacing jump (0.111 tiles inside, 1.38 at the rim) that doesn't show: the chop taper is zero at 6 tiles, so only the 179 m wave crosses it, at 18 samples per 1.38-tile cell.

Trains: roll 101 → 179 m (k 0.4357 → 0.2451, ω 0.24 → 0.18, period 26.2 → 34.9 s); wind sea 38 → 69 m (k 1.1462 → 0.6362, ω 0.39 → 0.29); fetch 130 → 440 km. `kA` is 0.113 roll / 0.239 wind against the 0.443 limit, and trough-to-crest is 63% of the limiting wave (60% before) while Hs nearly doubled. The superposition's worst face rose 35.8° → 41.6°, because more sea gives higher combined slopes; still under the 43° ceiling.

From a boat it reads as a long ocean swell, and that's correct. A low eye reads slope, and a 179 m wave with 8.6 m of crest subtends little; the drama in reference photos is shoaling water. For violence at eye level, steepness is the lever, and the chop is the term with room.

The hull's worst gale attitude went 11.1° → 9.0° → 6.3° across the three seas; she follows 96% of the water's movement (91% on the short sea). Nothing retuned.

Trap: the inertia gate went red on a working filter. It cross-correlated 240 samples at 50 ms, a 12 s window against a 34.9 s swell, over which deck height is nearly monotonic, and a ramp correlated with its shifted self peaks at zero. Its window and "not inertia" bar now derive from `SEA_ROLL.w` (three whole waves, searched to a quarter of one) and it reads 1.04 s. Same family as the `__glLights` bench answering the wrong question.

Hydro launches went 13.5 → 8.5 → 5.0 a minute at an unchanged 0.03-tile peak; `launchVs` still untouched. The cause: `SEA_AMP` was a module constant, so the sea grew only in its two long trains while the 4–8 m chop stayed calm-sized. Chop scaling was done 2026-09-27 (`seaChopGain`, `RENDER_TUNE.glChopState`) with no re-inversion, because foam is tested against the chop at unit amplitude, so the gain moves the drawn surface and never the whitecap fraction. The chop is fully developed by ~12 kt and already at ka ≈ 0.12, so a gale buys only ~30% (ka 0.136); a calm drops to 0.3×. Picture-side readers take `SEA_NOW.amp`; the hull launch chop (`seaAmpsNow`) is separate and unchanged.

The crest now reaches 1.23 tiles against a camera floored at 0.05, so a chase seat or free camera near the water spends much of a gale submerged. The dunk shader, Snell's window and wet glass handle it. The pilothouse (eye 1.35 m) is the seat that reads as a boat in a storm.

## Decal texture cache

`gl/decals.js` had `MAX_TEX = 192`, sized when decals were a few dozen sign boards. `emitDecoFill` now files every flat coloured quad there, keyed on its CSS string, and the derived kit put trim, plinths, crown courses, window bands, pilaster ranks and recessed bays on most of the registry. A Halcyon Fields cab frame wants 426 distinct decal textures. The tell: `batches` and `textures` came back equal at every district over the cap, meaning `evict` had deleted everything from the previous frame, re-creating ~230 textures a frame with `texImage2D`. It grows with every trim pass.

At 1024 the steady-state mint rate goes 91 → 26 a frame at Halcyon and 69/46/3 → 0 at civic, residential and nightlife, for well under a megabyte (`solidTex` 8×8 = 256 bytes, `rampTex` 4×32 = 512 bytes, against 156 MB per GL scene). Four interleaved A/Bs saved 1.0 / 3.0 / 2.3 / 9.3 ms off a ~29 ms frame; the new path measured 27.6 / 27.4 / 25.7 / 25.4 against 28.6 / 30.4 / 28.0 / 34.7, the lower variance reflecting no texture churn. `billboards.js` is fine: `bbTex` is a flat 241 under its 256 cap everywhere.

## District cost bench

`__glWhere` / `__glWheres` ([tools/modelshop/districtcost.js](../../tools/modelshop/districtcost.js)) profile the baked world at a district landmark from a cab or aeroplane; other benches build synthetic cities. Findings: the Glasshouse isn't special. At a cab seat, dense districts are Halcyon 48, residential 50, civic 44, Marrow 40 ms against Glasshouse 27, nightlife 27, industrial 20, docks 11. Face count runs the other way (nightlife draws the most, 45k, and is nearly cheapest; Halcyon draws 34k and is dearest), while decal count tracks the clock closely, which is what pointed at the cache.

Traps:
- Sweep order decided the answer. Six runs of one config went 55.3 → 46.3 → 40.0 → 41.6 → 36.5 → 37.7 ms as the renderer compiles and shape, kit and atlas caches fill, so the first district is charged for it (the first table showed Halcyon 96 ms against docks 11 because Halcyon is first in `PLACES`). A per-place `warm` doesn't help; the process is cold. The sweep pre-passes the whole list and keeps the minimum over reps.
- A fresh canvas per call is a fresh WebGL2 context; the page caps at 16 and force-loses the oldest, sending one config 40.2 → 38.4 → 45.1 → 56.1 → 59.7.
- A hidden Browser pane can't be timed: 43 ms visible, 124 hidden.
- The clock isn't frozen here, unlike pixel benches. `perfBegin` uses `performance.now()`, so a stubbed clock makes every phase read 0.000 ms with counts correct.

Per-model arm timing: `setWindshieldProfiler(true, { arms: true })`, off by default (two `performance.now()` calls per building per frame). Dense and cheap districts run the same seventy-odd arms; cost comes from which buildings. The worst is `shell_tower` at 0.52 ms a draw (Halcyon's half-built glass tower, 7.9 in view, 4.1 ms a frame) against `authored` at 0.07. It's only meaningful on the GL path, where the mass is suppressed and an arm's time is adornment collection. Only about a third of `world:arms` is inside `drawTypeModel` (the rest is marks, LOD and per-item loop work), so treat the table as a starting point.

## Vertex-animated layers (actors, birds, cloth)

Three layers play motion baked into RGBA16F textures, read by `gl_VertexID`: `gl/fauna.js` (bird
wingbeats), `gl/actors.js` (pedestrian clips) and `gl/cloth.js` (windsocks, the pier flag, the
Pitch's shelters). Each arrives as a record in `FAUNA_SINK` (`inst`, `actor`, `cloth`), which
`context.js` splits by kind. Texture units: 7 fauna, 20–21 actors, 24–25 cloth.

- **Actors have two bodies.** `actor3d.js` bakes a close-up body (2,380 vertices) and a far one
  (`bk.far`, 343). Between `RENDER_TUNE.actorFarPx` and `actorMeshPx` a figure is a `lod: 1` record;
  under `actorFarPx` it's still the canvas billboard. `scripts/shapes/actors.mjs` holds the split.
- **A standing figure's spot is street life's.** With `RENDER_TUNE.actorLife` on, where somebody
  stands, which clip they play and which way they face come from `glass/street-life.js`, not
  `vergeOffset`, and a gait reads the drawn position. A gate that expects everybody idle at the kerb
  spot facing along the street must turn it off first, as part 3 of `actors.mjs` does.
- **Birds have no CPU face path.** `pushFauna` always sends an instance record on GL frames. A gate
  that measures bird geometry expands records with `faunaRecordFaces` (fauna3d.js), the transform
  the shader mirrors.
- **Cloth needs the real pass.** `installGLCloth` is set only by `gl/install.js`, so every headless
  hook sees the old decals unless it opts in, as `scripts/shapes/cloth.mjs` does. Wind strength and
  direction are state and are always applied; only the phase stops when `motion` is 0.

The next frame-time work is CPU record building, not more animation: see [glass-headroom.md](../proposals/glass-headroom.md).

## Truss web LOD

`webBays`, `RENDER_TUNE.webLod` (0 is every lattice at its authored bay count). The bracing is what a truss costs: `latticeTower` is 3 legs and a top belt against 36 braced segments, and the count was a literal at every range.

- The measure is apparent size in pixels, since quay cranes, tower cranes and radio masts differ by an order of magnitude in height; the question is whether bracing covers more than a pixel.
- A jib is measured along itself; it's nearly horizontal, so its height would shed every bay.
- It sheds only the web; chords, legs and top belt are outside the bay loop, so the silhouette is unchanged. That's why it isn't an `ADORN_TIER` rung (a tier covers a whole building's budget).

Measured: strokes 1563 → 1316 at Halcyon, 953 → 837 at Marrow, 592 → 503 at nightlife (12–16%); the picture moves 0.20% against a 0.126% control; frame time doesn't move (eight A/Bs from −5.6 to +6.6 ms, mean −0.4). ~1,500 strokes is one draw call, so strokes aren't the bottleneck; don't spend more time on the stroke layer. It ships as a real reduction with an off switch and no visible cost.

## Cliff massifs

`RENDER_TUNE.cliffRough`, `cliffWarp`, and `plateau` in `BIOME_GROUND`. Reported as unnatural basin cliffs; measured over all 2,214 cliff and plateau tiles, three separate problems.

- **Level and roughness were one weighted mean.** `cliffHeightAt` answers which tableland this is (low frequency, big swing) and how broken its rim is (high frequency, real amplitude). As one mean over four octaves they trade off: reweighting toward fine detail doubled the tile-to-tile step and cut the massif swing from 49% of the median to 39%. Split (`cliffRelief` stretches the level, `cliffRough` adds on top), both rise: 52% and 2.83× the step.
- Trap: roughness is spent into the headroom, never clamped against the rail. Added and clipped, it pinned 2.4% of cliff tiles to one height, making a flat rim again (the trap the relief curve was already written around).
- **The plan-outline warp limit was a bound, not a measurement.** It was held under half a tile because corners a tile apart can close by W, but they're sampled from one noise a third of a cycle apart, so they mostly move together. The tightest lattice quad keeps 0.686 of its area at 0.50 and 0.502 at 0.85, so the outline is nearly twice as ragged with the fold still far off. `cliffLatticeSmoke` now reports the margin, not just pass/fail.
- **The caprock was darker than the plain.** Its palette comment claims *"the caprock top takes the sun"* and *"both sit deliberately in the redrock family"*, but `plateau` had luminance 55 against redrock's 99, so a cliff tile's cap came out at 73 and every massif read as a dark stain. A mesa top is the same rock as the plain; the face is what's dark. The cap is now 96 against the plain's 99, faces stay at 61 and 79.

`cliffrelief.mjs` was run by nothing (an npm name in neither list and no chain, the `gl:neighbour` case). It's now in `pretest:regress` and `shapes:smoke`, plus `npm run gl:cliff`. It makes four claims: each knob against its own control (relief 1 is a power of 1, rough 0 removes the term), and roughness staying out of the level, which is why they were split. Mutation-tested 5 of 5. Trap: "1 is exactly what shipped" went out of date in the commit that made the split; relief 1 is still the identity but no longer the shipped massif.
