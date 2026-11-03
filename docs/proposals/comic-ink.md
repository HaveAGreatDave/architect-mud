# Comic ink: the whole game in one comic-book style

> **Status: built and on by default (2026-11-02): the house style, the inked faces, the players,
> the park's lines and big plays replayed as a comic. Settings → Cel Shading turns it off. A phone
> draws no ink on the city ([Step 5](#step-5-as-built)).** The look-dev prototype is a live
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
5. **The switch defaults on.** *Built,* every tier at once rather than tier by tier. See below.

## Step 5, as built

Comic is the default (`celShade: 'comic'` in client/shared/settings.js `DEFAULT_SETTINGS`).

- **Saves from before.** A save holds every key, so a player who saved anything before 2026-11-02
  has `celShade: 'off'` stored as the old default rather than a choice. `loadSettings` moves 'off'
  to Comic once, for a save without `comicDefault`, and sets `comicDefault: 1`, which the next save
  keeps, so turning it off afterwards sticks. 'on' was always a choice and is left alone.
- **No city ink on a phone.** The city's outline (`glInk`) draws off a full-resolution depth prepass,
  the city drawn again, and PHONE_TIER turned off the occlusion it would have shared that prepass
  with. windshield.js `__setCelTune` applies the setting both at load and on a change, and zeroes
  `glInk` on the phone tier. The phone keeps the city's two-tone light and every figure's comic
  look, and the park's lines, which read the depth the park already has. `architect_gl_tier` =
  'full' brings the city's lines back with the rest of the full tier.
- **Not measured on a phone:** the park's screen pass at dpr 1 (Per tier, above). If a phone can't
  hold it, the quality governor ([diamond/quality.js](../../client/game/js/panels/diamond/quality.js))
  has no rung that drops it yet.

## Step 1, as built

[gl/house-style.js](../../client/game/js/panels/gl/house-style.js) holds the comic look's numbers:
one ink, two bands, a figure's line widened 2.5 times in its view's own units and held to 1.8 to
4.5 px of a 900-wide picture, and the city's outline at 2.5 CSS px to 30 tiles.

- **The switch** is a third value on the existing setting: Settings → Cel Shading → Comic
  (`celShade: 'comic'`). `_applyCelShade` in main.js now takes the setting's value rather than a
  boolean. It leaves `__houseComic` on the window, and hands the city's tune keys (`cityTuneFor`)
  to windshield.js `__setCelTune`, or leaves them in `__celShadePending` for it to apply when it
  loads.
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

## Comic replays

Dave's ask, 2026-11-01: comic angles, and slow motion or a pause with comic effects, on home runs
and the like. Decided: in replays only, so the live game never pauses; with all four effects (the
sound words, speed lines and halftone, comic panels, and tilted, extreme angles). Built behind the
same Comic setting, in [diamond/comic.js](../../client/game/js/panels/diamond/comic.js) and the
grandstand (gameday-grandstand.js).

Deadball already replays a big play ([diamond/replay.js](../../client/game/js/panels/diamond/replay.js)):
a home run, a walk-off, a double or triple play, a diving or leaping catch, a triple, a close play
at first, staged again in a world of its own and played at 0.4 from a second camera while the live
game carries on behind it. With Comic on, that replay runs in four beats:

1. **Run:** slow motion up to the moment, from a worm's-eye camera (`wormShot`): on the grass a
   dozen feet off, looking up. At the plate it's out in front on the side the batter faces; out
   on the field it's on the home side of the play, moved along so it stands on the field. The
   picture is graded like ink on newsprint (a CSS filter on the canvas, `.gds-print`) and framed:
   an ink border, a dot screen darkening the corners and a `SLOW MO` caption (`paintRun`).
2. **Freeze** (1.4 s): the replay world stops on its moment, and the held frame is redrawn as a
   printed panel (`printPanel`). A white flash, then a negative frame; the picture shaking; focus
   lines in to a clear ring; an explosion balloon popping out round the ball (red with darker
   Ben-Day dots, orange, yellow, a white core, each with an ink edge); motion streaks behind the
   ball the way it's going; and the sound, hand lettered letter by letter in Bungee (each letter
   its own tilt and a little bigger than the last, a deep red extrusion, a thick ink outline, a
   yellow-to-orange face): `KRAKK!`, `KA-BLAM!` or `THWOCK!` off the bat, `THWAP!` into the glove, `SNAP!`
   at the bag, `FWOOSH!` round to third, `BANG-BANG!` at first.
3. **After:** the rest in slow motion from the replay's own second camera, framed `AND THEN...`
4. **Page** (2.8 s): the three beats as a printed comic page: the moment big on the left with its
   burst on the ball and its word breaking out of the frame, the run-up above what followed on
   the right, captioned in Permanent Marker by kind (`THE PITCH...` / `...AND IT'S OUTTA HERE!`),
   the play told in a narration box in the big panel, and the headline (`HOME RUN!`) across the
   top.

**Seen on a real replay** (2026-11-02, a home run in the sandbox, its own panels) four things
were wrong, and are fixed:

- **The lens blurred the crowd to a smear**, and the print inked every speck of it. The comic
  cameras are sharp now: a fly shot takes its own `dof` (camera.js), and `wormShot` and
  `followShot` set 0.
- **The freeze buried the batter.** The lines and the word landed on him and the burst covered
  the bat at contact. `freezeLayout` now works from the player at the ball (the grandstand's
  `subjectAt`: whoever in the replay's world stands nearest the ball at its moment, the batter at
  contact or the fielder at a catch, as a circle from his feet to his head). The focus lines close
  on him and stop short of him, the burst goes beside the ball on his far side, and the word takes
  the corner clearest of both. The page's burst follows the same rule.
- **The last panel was a distant wide shot.** At the plate what follows is now `followShot`:
  low behind the batter, off his own shoulder, looking out over him as the ball climbs away. Out
  on the field the replay keeps its own second camera.
- **The narration said "HOME RUN" under HOME RUN!** It's left out unless it says more than the
  headline (`tellsMore`: four words or more, not the headline again).

**The print.** `printPanel` lifts the frame's mid-tones (a night game posterized as it comes is
mostly black), pushes saturation and contrast, flattens each channel to five inks, makes the
darkest solid ink, lays Ben-Day dots on a 45° screen through the half-tones, and inks every
brightness step (a Sobel edge). It runs once a panel, never per frame: the moment's frame and the
run-up's under the freeze's flash, what followed's as the page starts. About 30 ms for a 720-wide
frame on a desktop, 120 under software GL. A canvas that can't hand back its pixels gets the plain
shot back; the diamond smoke caught a throw there that would have stopped the grandstand's frame.

- **The lean.** The camera never rolls (diamond/camera.js), so the tilt is the picture's: a class
  on the park's box turns the canvas and the overlay 6° (and enlarges them 1.14 so the corners
  stay off screen), one way for the run and the other for what follows. The graphics stay level.
- **The panels** are taken off the GL canvas right after it's drawn, in the same task, so no
  preserved drawing buffer is needed; each is held at up to 720 px wide.
- **The slot.** The grandstand books a replay only if it ends before the next payload. A comic
  one is longer (`comicLength`), and a home run spends most of its hold on the trot and the
  fireworks, so it steps down (`comicFit`): the whole thing, else the freeze without the page,
  else the plain replay. It never costs a play the replay it would have had.
- **Reduced motion** keeps the plain still, as ever.
- **Room for it.** The server leaves a home run 21.5 s for the trot, 3.5 for the welcome, 10 for
  the replay and 10 for the reset (diamond/timing.js `AFTER`), and the replay is booked after the
  trot, so a full comic replay (at most 8.5 s of slow motion, the freeze and the page, about
  12.7 s) fits, taking the extra from the reset. Every other play with a replay has the same 20 s.
- **Checked** in Chrome: the freeze and the page painted over real frames from the park renderer
  (the Pose Lab, with Comic on) in the HUD's own faces, and a home run in the sandbox page
  (tools/sandbox/deadball-park-test.html?park=3d&play=hr) going through its beats in the real
  grandstand. Software GL draws the park at a frame or two a second, too slow to watch the freeze
  move, so look at one on a real GPU.
- **Gate:** scripts/shapes/comic-replay.mjs checks the length and the step-down, the camera
  (low, on the field, aimed at the moment, out in front at the plate), the panel times, the
  words, the page layout at three shapes, and that the painters draw at every beat. The diamond smoke plays a third replayed home run with Comic on through the real grandstand: run,
  freeze, after and page in order, the replay world still on its moment for the freeze's length,
  on to the end of its window after, all three panels taken, and the worm's-eye camera for the
  run and the freeze.
