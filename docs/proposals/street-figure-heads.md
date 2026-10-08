# Street figure heads in the game

**Status: phases 1 to 3 built; 4 and 5 are design.** The head is a client module ([actor-head.js](../../client/game/js/panels/actor-head.js)), the bake writes the two bones it rides, and the faces are a baked atlas ([actor-faces.js](../../client/game/js/panels/actor-faces.js)), but nothing in the game draws them yet. The game still draws the bake's head; the Actor Lab draws the new one with the atlas's faces.

The game's close-up figures ([actor3d.js](../../client/game/js/panels/actor3d.js), drawn by [gl/actors.js](../../client/game/js/panels/gl/actors.js)) have the bake's head: an 18 × 12 ellipsoid with lumps for features, on a neck as wide as its jaw. Up close it reads as a mask. The new head has a brow, a nose, lips and a chin in its profile, shaped ears, a neck narrower than the jaw, five hair styles grown off the scalp, and a face painted per person. This is the plan for bringing it to the game.

## What doesn't change

- **One figure per person, appearance from the token.** Hair, face and colours come off the actor token the way `ACTOR_OUTFITS` does, never off the NPC. A face drawn from the NPC's real description is an identity readable from a street away, which is what the token exists to prevent ([world-rendering.md](../reference/world-rendering.md)).
- **GLASS 2 only.** The canvas billboard and the far body (1.5 to 8 px) keep their heads. Nobody can see a face at that size.
- **No new CPU work per figure per frame** beyond a few more floats in the instance record. CPU record building is where the frame goes ([glass-headroom.md](glass-headroom.md)).

## The head is low-poly on purpose

The lab's first head was a loft of about 200 rings by 104 points, 21,370 vertices, and the first plan scaled that down to three levels (6,802, 1,448 and 462 vertices). Scaled down evenly, a loft loses its features before its vertices: the rings miss the nose tip and the mouth line, and the columns drift across the face from ring to ring.

So the head was redesigned (2026-10-07) as a loft whose edge loops sit on the face's landmarks, the way a hand-built game head is laid out. Each level lists its rings by height: even steps of angle over the crown (15° at L0), then one through the brow ridge, the brow, the nose's root, the eyes, the lower lids, the cheekbones, the nose's tip, the nostrils and the nose's base, the philtrum, both lips and the line between them, under the lip, and the chin. Across the face each level lists its columns by half-width, and a column holds that x from ring to ring, so one runs straight down each side of the nose, through each nostril, each mouth corner, each iris and each cheekbone. Over the crown and under the chin, where the rings are small, the columns ease to a fixed angle so they don't bunch. The sides and back get evenly spaced columns.

What falls between the loops is the face's to shade: its shade mask carries the sockets, the sides and underside of the nose and the mouth corners (section 3). The face texture is a front projection in metres, so every level takes the same face.

| level | from | head (skull, ears, neck) | hair, worst style | before the redesign |
|---|---|---|---|---|
| L0 | 250 px | 938 v / 1,840 t | 379 v / 640 t (long), 244 v otherwise | 6,802 v head, 1,925 v hair |
| L1 | 60 px | 362 v / 696 t | 153 v / 240 t | 1,448 v, 465 v |
| L2 | under 60 px | 128 v / 232 t | 63 v / 84 t | 462 v, 167 v |

The nose stands 20 to 23 mm off the face below the eyes at every level, which is what keeps L2 from being an egg. The lab's `head` shot and its L0/L1/L2 switch show each level close up; turn on the turntable for the profile.

The near body is 2,494 vertices and 4,780 triangles, of which the old head pieces (head, hair, eyes, brows, nose, lips, ears, neck) are 662 vertices and 1,256 triangles.

Painting one face on a canvas and uploading it as a texture, on an RTX 2070 SUPER: 4 to 11 ms plain, 14 to 17 ms with stubble, 25 to 40 ms with a full beard. Forced through `getImageData` it's 15 to 240 ms. Either way it's too slow to do while somebody walks into view, and a phone will be several times slower.

## The design

### 1. The head rides two bones; it isn't baked

The bake skins every vertex for every frame into a texture a column per vertex and `ceil(nv / 1024)` rows per frame, 240 frames tall. Baking the head would put all five hair shells into every figure.

The head doesn't need it: it's rigid on the head bone, and its neck blends the head bone into the neck bone. So the bake writes two matrices a frame into `bk.bones`, 240 frames by 6 RGBA32F texels (22.5 KB): the head's then the neck's, each as three rows `[m00 m01 m02 tx]`. Each takes a bind-space point to where the bake puts it, root surge and drop to the ground included (`ACTOR_HEAD_BONES` in actor3d.js). The head mesh is static, and the vertex shader places it with the frame's two matrices, blending clip A and clip B the way it blends positions now. The lab already places its heads this way (`boneAt` and `rideBone` in [actor-lab.html](../../tools/modelshop/actor-lab.html)).

The near body will lose its 662 head vertices, and its pose texture shrinks from 832 × 720 to 916 × 480 (two rows a frame instead of three).

### 2. Three levels of head, by how tall the figure is

A figure's head is about 0.13 of its height on screen. `headLevelFor(px)` picks the level off the pixel height `drawActorFigure` already works out.

| level | figure height | head on screen | where you'd see it |
|---|---|---|---|
| L2 | 8 to 60 px | up to 8 px | most of the street from the cab |
| L1 | 60 to 250 px | 8 to 32 px | the nearest people from the cab, the standing camera |
| L0 | over 250 px | over 32 px | the standing camera and free look, close up |

A found low-poly head would do as well: the face is a front projection in metres, so any head lined up to the landmarks in `FACE` (eyes at 1.6395 m, mouth 1.5652, chin 1.5215) takes the same faces. It has to be CC0 or equivalent, and converted into a data module, since there's no mesh loader.

### 3. A face atlas, tinted per person (built)

No face is painted at runtime. 32 layouts are painted once as masks, 256 × 320 each, into one atlas of 2048 × 1280 ([client/game/assets/actor-faces.png](../../client/game/assets/actor-faces.png), 697 KB, and a half-size copy for phones, 226 KB). The shader colours a layout with the person's own skin, hair, lips and eyes, so the variety is layouts times colours. A texel is four masks:

| channel | mask | what's in it |
|---|---|---|
| R | shade, a multiplier (1.5 × R) | sockets, the shadows under the nose and lip, folds and lines, nostrils, the lash line, the mouth line, and each hair's own brightness |
| G | hair | brows, stubble and beard, in the person's hair colour |
| B | lips | 0.5 and over is the lip, in the lip's own colour or the layout's lipstick; under 0.5 it's a flush of that colour on the cheeks and nose |
| A | 1 − the eye's opening | the opening only |

The eyes are in the same place in every layout, so the shader draws the white, the iris, the pupil, the lid's shadow and the catchlight from where the point is on the head. Any iris colour fits any layout, and the iris stays round at every size. A is 1 everywhere but the eyes, so a texel of plain skin is opaque and premultiplying can't touch it.

The layouts (`FACE_LAYOUTS`) vary age, stubble or a beard, makeup, the mouth and the brows: seven with stubble, five with beards, seven with makeup, and never a beard with makeup. A layout's age greys the hair (`faceHair`), so a young face never gets white hair from the colour pick. The order dress (Wildblood marks, an Ascendant's implant) stays in the lab.

The token picks a layout, an iris colour, a lipstick and a hair style (`actorFace`), exactly as it picks an outfit, from `rand(k)` slots 13 to 16, clear of the outfit's and of the ones `windshield.js` hashes. The colouring is one GLSL function, `FACE_GLSL`, which the lab's head shader includes now and the game's will in phase 4.

The painter ([tools/modelshop/face-masks.mjs](../../tools/modelshop/face-masks.mjs)) is the lab's `paintFace` step for step, each colour turned into the mask it comes from. It's plain JS over arrays rather than a 2D canvas: the bake runs in Node, so the gate can rebuild the atlas and compare it, and a canvas stores premultiplied colour, which can't carry four independent masks through an alpha channel. It paints the whole atlas in about 2 seconds. `npm run actors:faces` re-bakes it; the lab's "faces" switch shows the atlas or the canvas paint.

### 4. Drawing it

A second program in gl/actors.js, sharing the instance stream: about six more floats an instance (layout, hair style, iris colour, flags). One instanced draw per level for heads, and one per level and hair style for hair, so at most 18 small draws, usually a handful. The bone texture and the atlas take units 22 and 23, which nothing binds now (fauna has 7, the murmuration and clouds 8 to 17, actors 20 and 21, cloth 24 and 25). The lighting is the actor shader's, not the lab's: the key, sky over ground, rim, the city's lights (`uWL*`), the night dim (`uDim`), fog and the linear output. The mirror prepass gets heads for free, because it calls the same `draw()`.

### 5. The body around it

The shoulders are done: the coat's top slopes down from the neck instead of running out flat (the `yoke` shape in `buildBody`), and each sleeve starts in a closed cap that rounds over the shoulder instead of an open ring standing on it. The lab used to fake the slope in its vertex shader; it's geometry now, at both lods. What's left is `buildBody` at lod 0 dropping its head pieces, in the same change that draws the new head.

## What it costs

Per figure, once the body drops its old head (about 3,520 triangles left): about 3,820 at L2, about 4,400 at L1 and about 5,800 at L0 (6,000 with long hair), against 4,780 today. So L2 and L1 are no dearer than the figure the street draws now, and L0 costs about a fifth more rather than four times. Thirty L1 figures are about 132,000 triangles against 143,000 now.

Memory: the atlas is 10.5 MB on the GPU, 14 MB with mipmaps. A phone (`PHONE_TIER`) loads the half-size copy (3.5 MB with mipmaps). At L0's size there's no reason left to keep it off a phone. Mips stop at level 6 (`FACE_ATLAS.maxLevel`), the last that never mixes two faces.

CPU: the instance record grows by about six floats, and the level is picked off the pixel height `drawActorFigure` already works out.

## Phases

| phase | work | check |
|---|---|---|
| 1 ✅ | The head generator is a pure client module with three levels; the lab imports it from there | [scripts/shapes/actor-head.mjs](../../scripts/shapes/actor-head.mjs): vertex budget per level, skull and ears closed and wound outward, the neck's top inside the skull, the ears attached, no slivers, the nose off the face, no hair below the hairline |
| 2 ✅ | The bake writes head and neck matrices per frame (`bk.bones`) | the same gate: the matrices are rigid and put the bake's own head and neck vertices where the bake has them (to 0.2 µm); on every other frame of all eight clips the new neck's foot stays inside the collar and the head stays out of the coat |
| 3 ✅ | The painter paints masks; `npm run actors:faces` bakes the atlas PNGs; the token picks a face | [scripts/shapes/actor-faces.mjs](../../scripts/shapes/actor-faces.mjs): the committed PNGs are what the painter makes, pixel for pixel; atlas size and mip alignment; both eyes, the lips and the brows on every face, a beard on the bearded and none on the rest; no eye or lip near a cell's edge; the same token always gets the same face, realistic tokens reach every layout, and the pick carries nothing but the face |
| 4 | The head program in gl/actors.js, levels by pixel height; drop the near body's head pieces | `shapes:smoke`; `__glActors()` with the mesh on and off, from the cab and the standing camera; no record carries a token or an id |
| 5 | Docs, and the far body checked against the near one | the far body still stands within 0.03 m of the near one |

Phases 1 to 3 change nothing a player sees: the matrices and the atlas sit unused until phase 4 draws with them. The body's head pieces come out in the same change that draws the new head, never before. The shoulder change in phase 5 went in early, with phase 2, and players do see that.

## Left out

- **Order dress.** Wildblood marks, Ascendant implants, hoods and caps exist in the lab because it dresses people by district. The game's figures carry no order, and dressing them by the NPC's own order would be the identity leak above. District dress needs its own decision first.
- **Players' own faces.** Players are drawn as tokens like everybody else.

## Open questions

- How many layouts: 32 is a guess at enough variety on one street.
- Whether L2's square jaw needs one more column; it's only ever 8 px tall, so probably not.
