# Comic ink: the whole game in one comic-book style

> **Status: step 1 built (one house style behind Settings → Cel Shading → Comic); steps 2-5 are
> design.** The look-dev prototype is a live page in Dave's artifacts, "Deadball Comic Ink".

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
| Interior pass on the players | yes | yes | yes, at dpr 1 |
| Park and crowd in the pass | yes | yes | no |
| Inked textures | yes | yes | yes |
| Two tones and the edge line | yes | yes | yes |
| Hatching | yes | yes | no |
| Hi-def near level | yes | yes | no |

On the phone the screen pass stands in for the hull; its depth edge against the field draws the
silhouette too, at one width. Whether it's cheaper there is unmeasured, so the first build of step 4
logs both with `__glPassMs`.

## Order of work

1. **One house style.** *Built.* See below.
2. **The inked face atlas**, behind the switch, since every face changes the day it lands.
3. **The players:** weighted hull, inked kits, two tones with a painted shadow, hatching, the
   hi-def near level.
4. **The park and the crowd** through ssao.js's line resolve on the park's depth; the card
   shader's edge.
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
- **Not yet switched:** the park's players band their light with `CEL.bands` compiled into the
  shader, so they keep three bands until step 3 makes it a uniform. The rink's lit shader has no
  band count to switch.
