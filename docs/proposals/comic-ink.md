# Comic ink: the whole game in one comic-book style

> **Status: built and on by default (2026-11-02): the house style, the inked faces, the players,
> the park's lines, the rink ([The rink](#the-rink-as-built)) and big plays replayed as a comic,
> at the park and at the rink ([Comic replays at the rink](#comic-replays-at-the-rink-as-built-2026-11-11)).
> Settings → Cel Shading turns it off. A phone draws no ink on the city
> ([Step 5](#step-5-as-built)). What still falls short is in [Coverage](#coverage).** The look-dev
> prototype is a live page in Dave's artifacts, "Deadball Comic Ink".

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
- **Not switched then:** the rink's lit shader had no band count to switch, and the park's players
  had theirs compiled in. Step 3 made the park's a uniform, and [the rink](#the-rink-as-built) now
  takes the whole figure look.

## Step 2, as built

Since 2026-11-03 the close-up people (the Room Stage's, Deadball's players and the rink's heads) draw the inked atlas whatever the setting, and the street keeps the swap ([hd-figure.md](hd-figure.md#the-sports-people)).

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
- **The line** (`SKIN_INK_VS` in gl/ballpark.js) is thinner than the house line, at `HOUSE.parkFigure`, since a fielder is small in most shots and the house line filled him in black. It swells to `HOUSE.weigh` (1.7) times on the side
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

## The rink, as built

Rinkside ([gl/arena.js](../../client/game/js/panels/gl/arena.js)) gets the park's look, layer for
layer. Before this it took only the house ink and a wider hull, over smooth light with a rim.

- **The light.** LIT_FS takes `celKey` from [gl/cel-figure.js](../../client/game/js/panels/gl/cel-figure.js)
  for the men, the nets, the Zamboni and the loose things: two bands over the painted shade, a hard
  highlight, no rim, a line where the light steps, and hatching in full shadow. The rink has one
  key, from the banks (`KEY` in gl/arena-heads.js), so `celKey` is `celInk` and the bands under one
  light. `uCel` is set per draw, so the boards, the bowl and the gates' doors keep their own light,
  as the park's stands do. The heads (gl/arena-heads.js) take the same branch.
- **The hatching rides the man.** A rink body is rebuilt in rink space every frame, so it has no
  bind pose. `hatchBody` in [gl/arena-mesh.js](../../client/game/js/panels/gl/arena-mesh.js) writes
  each untextured vertex's place on him (feet across and up from his hips) into its uv, which
  nothing else reads; a sweater's own uv already runs round him (`SWEATER_FT`), and a head hatches
  in its bind space. His skating and his turning don't move the strokes; a swinging limb moves
  through them a little. It runs only with the look on.
- **One line on a man.** The rink draws the same line in both looks, 0.09 ft held between 1.2 and 3.6 px,
  in the house ink when comic is on. It sits 0.3 ft behind him at any range (`uBack` in gl/ink.js), so an
  arm keeps a line across his body. It takes no `HOUSE.weigh` and no wide house line: a seat on the glass
  puts a man close enough that those read as a slab. The screen pass is thin for the same reason
  (`HOUSE.rinkLinePx`). Sticks, skate steel and the puck take no line (`noInk` in gl/arena-mesh.js):
  they're thinner than it.
- **Inked sweaters.** `inkSweater` paints the park kits' strokes at the rink's slot scale: the side
  seams and the collar ruled, folds under the arms and off the hem, a quarter-strength painted
  shadow, and the number, the name and the plain crest outlined. The strokes are
  [comic-pen.js](../../client/game/js/panels/comic-pen.js), which diamond/kits.js now uses too. The
  look is in the slot key, so a flip repaints.
- **The screen pass.** The rink draws straight to the canvas, whose depth can't be read, so with the
  look on it draws the bowl, the fans, the boards and the men again into a depth of its own and
  runs gl/ssao.js `ink` over it (`rinkInkOf`). The camera's projection puts depth in w, so its
  constants are its own, not `ssaoConstants`. Outlines only, as in the park: the detail channel
  lines every row of seats. The lines go down after the ice, under the glass, the nets and the spray.
  The governor's last rung (`lines: false`) drops the pass; the men keep their hull.
- **Not measured:** what drawing the bowl and the fans a second time costs each frame, on any
  device.
- **Checked** in the rink sandbox (tools/sandbox/hockey-rink-test.html): off and Comic from the low
  camera; the lines' texture read back and the picture near black under its outlines. arena-smoke
  checks `hatchBody` holds a vertex's place on a moved and a turned man; house-style.mjs gates
  `rinkInkOf`.

## The comic light, as built (2026-11-03)

The two bands, the line where the light steps and the hatching in full shadow read as too much on people: every nose, fold and pad threw its own hard island of shadow, and the bands put the terminator near N·L 0.43, so half of every form was in shadow. Figures and rooms now take the comic light ([gl/comic-light.js](../../client/game/js/panels/gl/comic-light.js)) under the comic look instead:

- **One terminator, on the form.** Lit or in shadow by `comicStep`, a crisp antialiased step a little past side-on (`COMIC.wrap`, N·L −0.12), so a form is mostly lit with its shadow down the far side. People decide it on form normals ([form-normals.js](../../client/game/js/panels/form-normals.js)): the close-up figure has them baked as their own attribute; the sports' heads have their normals leaned onto them (`formLeaned`), and their bodies are smooth lofts already.
- **A shadow that's a value of the light**: about half of it, moved toward `HOUSE.shade`, darkest in a core just past the terminator and lifted again by the bounce (`comicShadeK`), with a thin rim lifting a silhouette in shadow.
- **No line or hatching inside a figure.** The ink pass's outline stays; the inked atlas draws the faces.

Where it is: `celKey` (gl/cel-figure.js), so the rink's men and heads; the park's players (gl/ballpark.js, per lamp bank in `celAdd`, the shadow after the loop); `roomLight` (gl/room-light.js), whose comic branch used to band the summed light and drew contour rings round the lamp across every wall; and the Room Stage's people (gl/figure-hd.js `comicTone`). `celInk` and the bands are still what the kitchen, the angler and the city use. The comic look's inked kit textures (step 3) are unchanged.

## Coverage

What each view takes of the look, after the rink. "Own" is the view's own light.

| View | Ink | Bands | Painted shade | Edge line, hatching | Weighted line | Inked textures | Screen pass |
|---|---|---|---|---|---|---|---|
| Park players | ✓ | ✓ | ✓ | ✓ | ✓ | kits | ✓ |
| Rink skaters | ✓ | ✓ | ✓ | ✓ | ✓ | sweaters | ✓ (not the last rung) |
| Angler | ✓ | ✓ | ✓ | no | no | no | no |
| Kitchen | ✓ | ✓ | own | no | no | no | no |
| Street people, buildings | ✓ | ✓ | own grey | no | no | no | city (not phones) |
| Vehicles ([V1](vehicle-comic.md#v1-as-built), [V2](vehicle-comic.md#v2-as-built)) | ✓ | ✓ | ✓ | no | the own ship | no | city (not phones) |
| Cockpits ([V5](vehicle-comic.md#v5-as-built)) | ✓ | ✓ | ✓ | ✓ | no (thin, even) | painted wear | no |

Bringing the vehicles and the cockpits up to the figures is scoped in
[vehicle-comic.md](vehicle-comic.md) (design).

Not touched at all: the hockey fly-in (gl/approach.js), what you hold in a box suite
(stands-hands-gl.js), and the park's plain fallback when its broadcast pass won't build. Comic
replays are Deadball's and the rink's ([Comic replays at the rink](#comic-replays-at-the-rink-as-built-2026-11-11)).

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

**The print.** `printPanel` (now in comic-print.js, both sports') lifts the frame's mid-tones (a
night game is dark) a little, smooths it, moves each channel of the smoothed colour a third of the
way to the nearest of eight inks, makes the darkest solid ink, lays light Ben-Day dots on a 45°
screen through the deepest shadow, and inks a thin line along each real edge. It keeps the models'
own colour: they're cel-shaded already, and the first prints (a gamma of 0.66, saturation 1.35,
six hard levels) blew a kit's blue out to cyan and the ice to paper white. rink-comic.mjs checks a
blue, a red, an ice white and a dark pant each come out within 26 of what went in, hue unchanged.
Deadball's slow-motion grade on its canvas (`.gds-print`) came down the same way, to a touch.
It runs once a panel, never per frame: the moment's frame and the run-up's under the freeze's
flash, what followed's as the page starts. About 100 ms for a 1280-wide frame on a desktop.

**Cleaner and thinner** (2026-11-11, Dave: "more HD and less noisy, thinner lines"). The first
prints inked every brightness step as a hard black pixel, so the crowd and the ice came out
speckled and the lines thick and jaggy, and the dots ran through every half-tone. Now the frame is
box-blurred first (`PRINT.soft`, a pixel at 720 wide, scaled with it), so texture makes neither
specks nor blotches; a line is inked only on the crest of the gradient across an edge, so it's one
pixel wide, and faded in with the step's strength (`edge` to `edgeHi`, in units where a step of
brightness Δ reads 4Δ at any size) so a faint edge is a faint line rather than a broken one; the
dots start lower (`dots` 0.16) and are lighter (`dotInk` 0.7). Both sports take their panels at
up to 1280 wide (it was 960). The painters' strokes are thinner too: the burst's outline, the focus
and speed lines, the motion streaks, the lettering's outline, and the frames and boxes on the page.
rink-comic.mjs checks it on a synthetic frame: a hard step gets a line at most two pixels wide on
every row, and grain and a busy crowd get no ink at all. A canvas that can't hand back its pixels gets the plain
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
**More of them, and better drawn** (2026-11-10):

- **Five more plays earn a replay** (replay.js `replayOf`): a play at the plate (`plate`), a close
  one at second or third as well as first (`close`), a catch at the wall or over the rail as its
  own kind (`robbed`), a man thrown out stealing and a steal the tag missed by under 0.16 s
  (`caught`, `steal`), and strike three that ends an inning with a man on, or a close game from
  the ninth (`strikeout`, from the side the hitter faces, through the umpire's call). A strikeout
  and a steal have no bat on the ball, so a replay's times count from `anchorOf`: contact, or the
  pitch in the mitt. The server leaves a big strikeout and a man caught stealing the replay's 10 s
  (timing.js `bigStrikeout`, `caughtStealing`); a close play takes its room from the booth's talk,
  because only the staged play knows how close it was.
- **Inks by kind** (`comicInksOf`): off the bat the word and the burst are yellow, orange and red;
  into a glove they're white and blue; in the dirt at a bag, cream and tan. Every kind has its own
  words, captions and headline (`ROBBED!`, `PLAY AT THE PLATE!`; a grand slam says so).
- **The run** has speed lines in from the edges, drawn afresh eight times a second, and a box at
  its foot saying where the game is (`BOTTOM OF THE 7TH`).
- **The page** turns the other way round on alternate plays (`pageLayout(w, h, flip)`) and has a
  masthead top right, `DEADBALL COMICS No. 7`, numbered by the inning.
- **The print** is taken at up to 960 px wide (1280 since 2026-11-11), and its dot screen scales
  with the frame, so it holds up on a big screen.

**The videoboard** (diamond/jumbo.js, behind left-centre) shows the replay as it's taken and twice
more after. Four things were wrong with it, and are fixed:

- It took a frame every other screen frame and kept 160, so at 60 Hz the reel was full after five
  seconds and the board sat on one frame for the rest of a thirteen-second comic replay. It takes
  12 a second by the clock now, and a reel that fills is thinned to every other frame and carries
  on, so the whole replay is always there.
- A prompt (`HOME RUN!`) that was up when the replay ended ran the replay's two loops out behind
  it. The loops start when the board first shows them.
- The comic replay's freeze and page were printed a second time on the board, which inked the
  lettering and the dots again. A frame that's a print already goes up as it is, and the board
  letters no second word over a comic replay.
- The score never repainted when the clubs' colours came in, so it kept the house colours.

**From a seat in the stands** the game shows no replay, so the board stages its own. With Comic on
that one's a comic too: the worm's-eye run, the moment frozen and printed with its burst and its
word for 1.4 s, and what follows (no page; the board's small). In a suite, the box's own screen
carries the board's picture while a replay's on it, and the director's shot again after.

**Dead air.** More replays mean more time when the men on the field have nothing to do, and a
seat in the stands watches all of it. Seven new idle clips (a long look round, hands on hips, arms
folded, shaking the arms loose, the throwing arm pulled across the chest, a coach's claps, and an
infielder holding up the outs) and a pool for each kind of man (between.js `FIDGETS`): fielders,
the catcher, a man on a bag, and now the umpires and the base coaches, who stood like posts. They
are the live game's own (`planBetween` puts them in the live world), not a cutaway's, so they're
there whether a camera's on them or not. The aim is for most of the idle business to live there.

- **Gate:** scripts/shapes/jumbo-smoke.mjs plays a home run to the real grandstand from a seat:
  the board takes its replay and plays it again, the comic one runs, freezes and runs on with its
  world still through the freeze, the live clock never stops, and a suite's screen gets the board's
  picture at 640 by 360. comic-replay.mjs also checks the new kinds' words and inks, the flipped
  page, which strikeouts and steals earn a replay, and the board's reel.
- **Not seen on a GPU yet.** The painters and the board were looked at over a drawn stand-in
  picture; the Browser pane had no WebGL2 on the day, so the park itself, the new clips on a body
  and the suite's screen have only been through the gates.
- **Gate:** scripts/shapes/comic-replay.mjs checks the length and the step-down, the camera
  (low, on the field, aimed at the moment, out in front at the plate), the panel times, the
  words, the page layout at three shapes, and that the painters draw at every beat. The diamond smoke plays a third replayed home run with Comic on through the real grandstand: run,
  freeze, after and page in order, the replay world still on its moment for the freeze's length,
  on to the end of its window after, all three panels taken, and the worm's-eye camera for the
  run and the freeze.

## Comic replays at the rink, as built (2026-11-11)

Dave's ask: comic replays for big shots, big hits, fight wins and big saves. The rink's replays
run in Deadball's four beats (run, freeze, after, page), behind the same Comic setting and never
with reduced motion. The painters moved out of diamond/comic.js into
[comic-print.js](../../client/game/js/panels/comic-print.js), which knows no sport;
diamond/comic.js re-exports them and keeps Deadball's words, cameras and masthead. The rink's are
in [rink/comic.js](../../client/game/js/panels/rink/comic.js).

**What earns one** (rink/director.js):

| Moment | When it's shown | Word, headline |
|---|---|---|
| A goal | on the booth's replay cue, in place of the plain replay | `SNIPE!`, `GOAL!` (`POWER-PLAY GOAL!`, `EMPTY NET!`) |
| A shot off the post | at the next stoppage | `PINGG!`, `OFF THE POST!` |
| A glove save, a pad save, a breakaway stopped | at the next stoppage | `THWAP!`, `GLOVE SAVE!` |
| A hit on the boards | at the draw the booth brings it up over, seen or not | `KA-RUNCH!`, `BIG HIT!` (`INTO THE GLASS!`) |
| The punch that knocks a man down | once the camera's pulled back from the winner | `POW!`, `KNOCKOUT!` |

A routine save, a miss, a drawn fight, a fight that ends with the sweater over his head (nobody goes
down, so there's no finish to draw) and a slash get no comic replay. A grave hit or fight keeps
its X-ray replay, which is never a comic one too.

- **The slot.** A goal's replay is fitted between the booth's `replay` and `live` cues, as
  before; a comic one gives the freeze and the page their 4.2 s and fits the slow motion into
  what's left, dropping the page and then the freeze when the gap's short (`comicPlan`). A kept
  moment (`D.comic`) is shown once play is stopped, with up to `RINK_COMIC.room` (11 s), or to the
  draw's drop when a draw is waiting, and it goes behind the wipe if the draw comes sooner. Only
  the latest is kept; a hit the booth brings up wins over it, and a goal, a death or a period's
  end drops it, as the booth has moved on.
- **A hit in the picture.** Before, only a hit the picture missed was kept for the booth to bring
  up. With comic replays on, every hit is, and one the picture saw is only ever replayed as a
  comic.
- **The page is a story** (comic-print.js `paintStory`, Dave's call on seeing the first ones): the
  action big on the right, and down the left, small, just before it and just after it. The action
  is the freeze's frame, with the burst, the sound word in the corner clearest of the man and the
  burst, and the play told along the edge away from the burst. "Before" is taken
  `RINK_COMIC.before` of the way through the run-up; "after" is the clip's last frame, and every
  clip runs on past the moment far enough for that to be the finish (`RINK_COMIC.after`, 1.8 s; a
  goal's 2.2 s): the puck in the net with the lamp on, the puck in his glove, the man flat on the
  ice. Their captions run into each other (`HE WINDS UP...` / `...LIGHT THE LAMP!`). Deadball's
  page (`paintPage`) is as it was; the paper, the masthead and the headline are shared.
- **The action, by kind.** A goal's is the shot that went in leaving the stick (the director notes
  every shot struck, `D.lastShot`), not the puck crossing the line; a save's is the puck into
  the glove or off the pad, with the replay camera on the goalie rather than the puck; a hit's
  the impact; a fight's the punch landing.
- **The goalie in the clear.** A replay framed on a goalie leaves out the men between the replay
  camera and him (rink/replay.js `clearView`, within 4 ft of the line; the renderers leave the
  replay camera's eye on its source each frame). A save's does it throughout; a goal's from the
  freeze on, when its camera swings to the goalie under the printed frame (`then`), so the shot
  itself keeps everybody and "after" is the puck going in behind him.
- **Recording.** A post, a big save and a knockdown are recorded from the play's start (a
  fight's from 3.5 s before its last punch), which only happens with comic replays on.
- **The clock** is the replay's own (rink/replay.js): it stops on the moment for the freeze and at
  the end for the page, so the stand-in world stands still under both, and `left` counts them.
  The live game plays on underneath, as with every replay.
- **The freeze** bursts on the puck (a goal, a post, a save, its goalie kept clear), between the
  two men (a hit, the man hit kept clear) or on the loser's head (a fight). The panels are taken
  off the picture as each beat passes, in the frame's own task, so a WebGL canvas needs no
  preserved buffer: rink/hud.js `drawHud` takes the replay camera's projection and the canvas
  from both renderers.
- **Inks.** A goal is hot, a post and a save cold, a hit a bruise purple, a fight blood red.
  The page's masthead is `RINKSIDE COMICS`, numbered by the period, and the run's foot says the
  period, or for a hit who hit whom. The scorer's lower third stays off the freeze and the page.
- **Not done:** the lean and the newsprint grade on the picture (Deadball's CSS on its canvas),
  and a worm's-eye camera; the rink's replay keeps its own ice-level camera.
- **Seen on WebGL** in the rink sandbox (tools/sandbox/hockey-rink-test.html, stepped by hand in a
  hidden pane): a glove save, a goal (its booth cues added by hand: the sandbox's payloads carry
  none) and a knockdown, each through run, freeze, after and the page. Not seen: a hit, which
  needs the booth to bring it up at a draw.
- **Gate:** scripts/shapes/rink-comic.mjs checks every kind's word, captions, headline and
  narration, the step-down, the story page's layout, the replay's held clock against `left`, and
  that a man between the camera and the goalie is left out (and only from the freeze on for a
  goal); then plays slot 289
  through the view with Comic on until a goal, a save, a hit and a fight have each been replayed
  as a comic and one has reached its page: beats in order, inside the window, the freeze still,
  the live clock never held, and every page's last frame at least a second past its moment. In
  that game, played to the end, about 20 moments get one, saves the most.
