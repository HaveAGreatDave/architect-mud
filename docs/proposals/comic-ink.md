# Comic ink: the whole game in one comic-book style

> **Status: steps 1-4 built (the house style, the inked faces, the players and the park's lines,
> behind Settings → Cel Shading → Comic); step 5 is design.** The look-dev prototype is a live
> page in Dave's artifacts, "Deadball Comic Ink".

## Why

Every 3-D view already has a cel look, each its own: the park's players
([gl/cel-figure.js](../../client/game/js/panels/gl/cel-figure.js)), the rink's skaters, the kitchen,
the angler on the skiff, and the city's mass behind the Cel Shading setting
([glass-notes.md](../reference/glass-notes.md#the-cel-look-render_tunegltoon-glink)). They have four
ink colours, four sets of line widths and three bands. The players' line is a hairline, 0.035 ft
held to 0.8 to 1.5 px of a 900-wide picture, and the phone tier draws none
([diamond/quality.js](../../client/game/js/panels/diamond/quality.js) `ink: false`).

The target is Borderlands. Gearbox says it isn't cel shading: it's hand-drawn textures scanned and
coloured, plus an outline drawn by a screen-space edge filter over depth and normals, and sharpened
shadows. The engine's line is one width everywhere; the variety (thick and thin, folds, wear) is ink
painted into the textures. The people who texture in that style put black lines in the base colour,
paint white highlight lines and shadows into it at about a quarter strength, and vary line sizes.

Decided 2026-11-01: the whole game goes comic, faces included.

## The five layers

1. **A weighted silhouette.** The inverted hull the players and the rink already draw
   ([gl/ink.js](../../client/game/js/panels/gl/ink.js)), at about 2.5 px of a 900-wide picture,
   swelling to about 1.7 times on the side away from the sun.
2. **Interior lines from a screen pass.** Edges from depth, normal and a part number: an arm across
   the chest, a sleeve hem, the belt, the bill over the face. The city already has this pass
   (`glInk`, resolved in [gl/ssao.js](../../client/game/js/panels/gl/ssao.js) off the occlusion's
   depth prepass), and the park already resolves its depth to a texture for its own occlusion
   (gl/ballpark.js, pass 3), so the park and the crowd reuse ssao.js's line resolve on that depth
   rather than a new pass.
3. **Ink in the textures.** The kit atlas is painted on a canvas
   ([diamond/kits.js](../../client/game/js/panels/diamond/kits.js)), so its ink costs nothing per
   frame: hand-ruled pinstripes, seams, fold strokes at the elbow and the bloused knee, a
   quarter-strength painted shadow under the belt and in the armpits, dirt on the knees.
4. **Two tones, painted, hatched.** Two bands with a hard edge, a painted shadow colour per kit, a
   fine ink line along the light's edge, hatching in body space in the deepest shadow, a hard white
   glint on helmets, bats and shoes, and no rim.
5. **Definition where the line can see it.** The near level of detail only: torso 34 to 48 columns,
   limbs 14 to 24, a sleeve shell with its own hem, trousers bloused over the stirrups, hands and
   gloves up 15%.

### Lines between garments, never inside one

The prototype drew a line across the top of the legs, where the thighs meet the seat. The trousers
are one garment, so that line is wrong. The rule for both line layers:

- The interior pass draws a part-number edge between garments (jersey on trousers, sleeve on arm,
  the belt), and inside one garment only a large depth step.
- Where one piece of a garment grows out of another (a thigh out of the seat), its hull is pushed
  back in depth near the join, so the cloth hides it there and it still shows on the silhouette.

## Decisions

- **The crowd and the umpires get the ink.** The umpires are built by the players' body code, so
  they come with it. The crowd is thousands of instanced fans
  ([gl/crowd.js](../../client/game/js/panels/gl/crowd.js)), too many for a second draw each, so it
  takes its line from the screen pass, and the far fans drawn as cards ink their own edge in the
  card shader.
- **The park goes through the interior pass.** The bowl, the dome, the scoreboard and the city, so
  the broadcast reads as one comic. The depth is already there wherever the occlusion runs, so the
  cost is one full-screen resolve. The phone tier runs no occlusion (`ao: 0`), so there it would pay
  for the depth as well; the phone keeps the pass on the players only.
- **Faces get inked.** No face is painted at runtime: 32 layouts are baked as masks into one atlas
  ([actor-faces.js](../../client/game/js/panels/actor-faces.js)), and its shade channel already
  carries the lash line, the mouth line and the folds. Inking means repainting that channel in
  [tools/modelshop/face-masks.mjs](../../tools/modelshop/face-masks.mjs) with real line weight and
  rebaking. The atlas is the street figure's too, so every face in the game changes with it.

## Per tier

| Layer | Full | Laptop | Phone |
|---|---|---|---|
| Weighted hull | yes | yes | no |
| The park's screen-pass outlines | yes | yes | yes, at dpr 1 (unmeasured) |
| Inked textures | yes | yes | yes |
| Two tones and the edge line | yes | yes | yes |
| Hatching | yes | yes | yes (no tier gate yet) |
| Hi-def near level | yes | yes | built, but the phone draws a level coarser (`detail: 1`) |

On the phone the screen pass stands in for the hull; its depth edge against the field draws the
silhouette too, at one width. Whether it's cheaper there is unmeasured, so the first build of step 4
logs both with `__glPassMs`.

## Order of work

1. **One house style.** *Built.* See below.
2. **The inked face atlas**, behind the switch, since every face changes the day it lands.
   *Built.* See below.
3. **The players:** weighted hull, inked kits, two tones with a painted shadow, hatching, the
   hi-def near level. *Built.* See below.
4. **The park and the crowd** through ssao.js's line resolve on the park's depth. *Built.* See
   below.
5. **The switch defaults on**, tier by tier, once the park's governor
   ([diamond/quality.js](../../client/game/js/panels/diamond/quality.js)) holds its rungs.

## Step 1, as built

[gl/house-style.js](../../client/game/js/panels/gl/house-style.js) holds the comic look's numbers:
one ink, two bands, a figure's line widened 2.5 times in its view's own units and held to 1.8 to
4.5 px of a 900-wide picture, and the city's outline at 2.5 CSS px to 30 tiles.

- **The switch** is a third value on the existing setting: Settings → Cel Shading → Comic
  (`celShade: 'comic'`). `_applyCelShade` in main.js now takes the setting's value rather than a
  boolean. It leaves `__houseComic` on the window, and writes the city's tune keys (`cityTuneFor`)
  into `__wsTune`, or leaves them in `__celShadePending` for windshield.js to apply when it loads.
  An older boolean in `__celShadePending` is still read.
- **The readers** ask at draw time, so a change shows on the next frame: the park's players and
  the angler (`inkOf` in gl/ballpark.js and glass/rod-rig.js), the rink (gl/arena.js), the kitchen
  (gl/kitchen.js, bands too) and the city's ink colour (`cityInkCol` in gl/context.js).
- **Off, nothing changes.** Every helper hands back the view's own numbers, and the city's keys for
  'off' and 'on' are windshield.js's shipped defaults. `scripts/shapes/house-style.mjs` gates both,
  reading the defaults out of windshield.js.
- **Not switched:** the rink's lit shader has no band count to switch. (The park's players had
  theirs compiled in; step 3 made it a uniform.)

## Step 2, as built

A second face atlas, `actor-faces-ink.png` and its half-size copy, painted by the same painter
([tools/modelshop/face-masks.mjs](../../tools/modelshop/face-masks.mjs) `paintFaceMasks(layout, {
ink: true })`). The face is painted exactly as before, then an ink layer goes into the shade channel
last: a heavy tapered upper lid with a flick at the outer corner, the crease above it, the lower
lid's outer half, the brows darkened and underlined, the nostril wings, one side of the nose down
the bridge and round under the tip, a heavier mouth line with its corners, the folds from the nose
to the mouth (heavier with age), under the lower lip and a chin crease.

- **Only the shade channel moves, and only darker,** so hair, lips and the eye's opening are the
  plain atlas's exactly, and the shaders need no change: a darker shade texel is already a line.
- **The swap** is [gl/face-atlas.js](../../client/game/js/panels/gl/face-atlas.js): one feed a
  texture, polled each frame by the street figures (gl/actors.js), the park (gl/ballpark.js) and the
  rink (gl/arena-heads.js). It fetches the atlas for the look that's on and hands it over once
  decoded, so the old faces stay up meanwhile. A look flipped mid-load drops the stale image. The
  park's feed calls `onAsset` when an image lands, so an idle grandstand draws a frame; the upload
  itself only ever happens inside a frame, on the faces' own texture unit.
- **The bake:** `npm run actors:faces` writes all four PNGs. The inked pair is about 3% bigger than
  the plain, and only a viewer with Comic on downloads it.
- **Gates.** `scripts/shapes/actor-faces.mjs` repaints and compares both atlases, runs every face
  check on both, fails an inked atlas that moves anything but the shade channel or lightens a texel,
  and counts dark texels at the lids, brows, mouth and nostrils of every layout (a blank ink layer
  fails it on every face). `scripts/shapes/face-atlas-feed.mjs` drives the feed with a fake image
  through each flip, including off-on-off mid-load.

## Step 3, as built

The park's players, seen in the Modelshop's Pose Lab under the real renderer: plain, Comic, and
plain again pixel for pixel.

- **The light.** `CEL_GLSL` ([gl/cel-figure.js](../../client/game/js/panels/gl/cel-figure.js))
  takes its bands and shade as uniforms (`uCelBands`, `uCelShade`, `uCelComic`), set from
  `figureLightOf` in gl/house-style.js. Off they're `CEL.bands` and `CEL.shade`, so the players draw
  as before. Comic gives two bands, a painted warm violet shade (`HOUSE.shade`), no rim, and
  `celInk`: a line wherever the banded light steps (its `fwidth`, so every band edge and every hard
  shadow edge gets one) and hatching in full shadow. The hatching is laid in the man's bind pose
  (`vBind`, a new varying on the park's two lit vertex shaders), so it rides his body, and it builds
  up only where he turns away from his brightest light (`keyD`, from `celAdd`). A first cut hatched
  all of full shadow, and under the floods from behind that was his whole front.
- **The angler** (glass/rod-rig.js), shaded on the CPU, takes the same bands, shade and no rim.
- **The line** (`SKIN_INK_VS` in gl/ballpark.js) swells to `HOUSE.weigh` (1.7) times on the side
  away from `uKey`, the sun or straight up under the floods. At weight 1 it's the old line exactly.
- **The kits** ([diamond/kits.js](../../client/game/js/panels/diamond/kits.js) `ink`): numbers and
  lettering outlined, seams and the placket hand-ruled, the collar's edge, folds off the tuck and
  under the arms, a quarter-strength painted shadow under the arms and at the tuck; trousers with
  ruled seams, folds at the hip, behind the knee and over the stirrups, dirt and grass on the
  knees; folds at the top of the socks. The look is in every slot's key, so a flip repaints the
  atlas, and the park repaints it the frame it sees the flip. Painted without ink, the atlas is
  byte for byte what it was (checked against the committed painter in Chrome).
- **The hi-def near level** ([gl/ballplayer-mesh.js](../../client/game/js/panels/gl/ballplayer-mesh.js)
  `createPlayerSet({ hd })`): at level 0 only, 1.5 times the columns round the torso, limbs,
  shoulders and shoes, and rings twice as close down the limbs and torso. A full player goes from
  about 14,000 triangles to about 27,000 at the near level; levels 1 and 2, which the broadcast
  distance and the shadows use, don't change. A flip rebuilds level 0 of every body 3 ms a frame
  inside `render`, each man keeping his old one until his new one is up, because the grandstand
  stops drawing while `pump` has work.
- **Gates.** ballpark-smoke builds every role hi-def (finer at level 0 only, inside twice its
  budget, every weight sound) and flips the kits' ink both ways (every jersey and both sides' legs
  repaint, the same look again repaints nothing). house-style.mjs checks `figureLightOf` off and on.
  The park's lit and ink programs were compiled and linked in Chrome with every new uniform live;
  glsl-smoke only reads names.

Left for later: the proportions (hands and gloves up 15%, a sleeve shell with its own hem, trousers
bloused in the mesh rather than the texture), ink in the bat's and glove's textures, and the
interior lines, which are step 4's screen pass.

## Step 4, as built

The park's picture gets the city's lines: `createDepthSSAO` in
[gl/ssao.js](../../client/game/js/panels/gl/ssao.js) now has an `ink` method that runs the city's
`INK_FRAG` over the depth the park already resolves (pass 3), and the lens in
[gl/broadcast.js](../../client/game/js/panels/gl/broadcast.js) lays them over the encoded picture
in near black before the grade. The numbers are `parkInkOf` in gl/house-style.js; without Comic
it's null, so no line is drawn and no depth is kept for one.

- **Outlines only.** The field is in this depth, and the city's never has the ground in it. The
  detail channel's one-texel taps read the grazing grass as creases in alternate rows, and the
  jersey's placket groove as a black stripe, at any fold angle. So the park's detail lines fade
  out before they start, and only outlines are drawn: the stands and the bowl on the sky, a man
  against the field, the fence. The players' inner contours (an arm across his chest) come from
  their own line.
- **The crowd needs nothing of its own.** The near fans are geometry, and the far fans' cards
  discard outside the figure, so both are in the depth with their silhouettes, and the pass inks
  them. The card-shader edge this doc planned isn't needed.
- **Every tier**, the phone included. The phone has no occlusion, so on it Comic pays for the
  depth blit as well as the pass, at its dpr of 1. It's the phone's only outline (its tier has no
  hull), and it's unmeasured; the governor's numbers decide whether it stays.
- **Only through the broadcast pass** (gl/broadcast.js). The plain-curve fallback the park uses
  when that pass won't build draws no lines.
- **Checked** in the Pose Lab: off, Comic, and off again pixel for pixel; the lens compiled and
  linked in Chrome with its four new uniforms live. house-style.mjs gates `parkInkOf`.
