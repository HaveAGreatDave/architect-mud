# Street figure heads in the game

**Status: design.** The head exists only in the Actor Lab ([actor-head.js](../../tools/modelshop/actor-head.js)). The game still draws the bake's head.

The Actor Lab's figures have a sculpted head: skull, brow, sockets, cheekbones, nose, lips and chin in the geometry, shaped ears, a neck narrower than the jaw, five hair styles grown off the scalp, and a face painted per person. The game's close-up figures ([actor3d.js](../../client/game/js/panels/actor3d.js), drawn by [gl/actors.js](../../client/game/js/panels/gl/actors.js)) still have the bake's head: an 18 × 12 ellipsoid with lumps for features, on a neck as wide as its jaw. This is the plan for bringing the lab's head to the game.

## What doesn't change

- **One figure per person, appearance from the token.** Hair, face and colours come off the actor token the way `ACTOR_OUTFITS` does, never off the NPC. A face drawn from the NPC's real description is an identity readable from a street away, which is what the token exists to prevent ([world-rendering.md](../reference/world-rendering.md)).
- **GLASS 2 only.** The canvas billboard and the far body (1.5 to 8 px) keep their heads. Nobody can see a face at that size.
- **No new CPU work per figure per frame** beyond a few more floats in the instance record. CPU record building is where the frame goes ([glass-headroom.md](glass-headroom.md)).

## Measured (2026-10-04)

Head geometry, from the lab's generator at three settings. Ears, neck and the long-hair sheet are scaled with the skull; left at full resolution they hold every level above about 1,400 vertices.

| level | head (skull, ears, neck) | hair, worst style | triangles in all |
|---|---|---|---|
| lab | 21,370 v | 5,720 v | about 53,500 |
| L0 | 6,802 v / 13,552 t | 1,925 v / 3,520 t | about 17,100 |
| L1 | 1,448 v / 2,856 t | 465 v / 784 t | about 3,640 |
| L2 | 462 v / 892 t | 167 v / 250 t | about 1,140 |

The near body today is 2,380 vertices and 4,528 triangles, of which the head pieces (head, hair, eyes, brows, nose, lips, ears, neck) are 662 vertices and 1,256 triangles.

Painting one face on a canvas and uploading it as a texture, on an RTX 2070 SUPER: 4 to 11 ms plain, 14 to 17 ms with stubble, 25 to 40 ms with a full beard. Forced through `getImageData` it's 15 to 240 ms. Either way it's too slow to do while somebody walks into view, and a phone will be several times slower.

## The design

### 1. The head rides two bones; it isn't baked

The bake skins every vertex for every frame into a texture a column per vertex and `ceil(nv / 1024)` rows per frame, 240 frames tall. A 21,000-vertex head would need 21 rows a frame, 5,040 rows in all, past WebGL2's guaranteed 2048. Even an L1 head that fits would need all five hair shells baked into every figure.

The head doesn't need it: it's rigid on the head bone, and its neck blends the head bone into the neck bone, exactly as the lab draws it (`attachRest` and the neck frame in [actor-lab.html](../../tools/modelshop/actor-lab.html)). So the bake writes two matrices a frame (head and neck, each with the same root surge and drop to the ground the vertices get) into a small texture: 240 frames by 6 RGBA texels. The head mesh is static, and the vertex shader places it with the frame's two matrices, blending clip A and clip B the way it blends positions now.

The near body loses its 662 head vertices. Its pose texture shrinks from 794 × 720 to about 860 × 480.

### 2. Three levels of head, by how tall the figure is

The generator is a function of a few counts (points round a ring, ring spacing, ear and neck resolution), so the levels are settings of the same code and share the face mapping and the hairline. A figure's head is about 0.13 of its height on screen.

| level | figure height | head on screen | where you'd see it |
|---|---|---|---|
| L2 | 8 to 60 px | up to 8 px | most of the street from the cab |
| L1 | 60 to 250 px | 8 to 32 px | the nearest people from the cab, the standing camera |
| L0 | over 250 px | over 32 px | the standing camera and free look, close up |

A found low-poly head would do as well as a generated one: the face is a front projection in metres, so any head lined up to the lab's landmarks (eyes at 1.6395 m, mouth 1.5652, chin 1.5215) takes the same faces. It has to be CC0 or equivalent, and converted into a data module, since there's no mesh loader.

### 3. A face atlas, tinted per person

No face is painted at runtime. The painter (`paintFace` in the lab) is rewritten to paint layouts as masks rather than colours: skin shading (sockets, the nose's shadow, age lines), a hair mask (brows, lashes, stubble, beard), a lip mask and an eye mask. About 32 layouts at 256 × 320 go into one atlas, 2048 × 1280. The shader tints each with the person's skin, hair, lip and iris colours, so variety is layouts times colours, not layouts alone.

The atlas is baked to a PNG by the Modelshop and committed under `client/game/assets/`, the way a Modelshop save re-bakes `building-models.js`. The game loads an image and paints nothing. The token picks a layout index, a hair style and the colours, exactly as it picks an outfit.

### 4. Drawing it

A second program in gl/actors.js, sharing the instance stream: about six more floats an instance (layout, hair style, iris colour, flags). One instanced draw per level for heads, and one per level and hair style for hair, so at most 18 small draws, usually a handful. The bone texture and the atlas take units 22 and 23, which nothing binds now (fauna has 7, the murmuration and clouds 8 to 17, actors 20 and 21, cloth 24 and 25). The lighting is the actor shader's, not the lab's: the key, sky over ground, rim, the city's lights (`uWL*`), the night dim (`uDim`), fog and the linear output. The mirror prepass gets heads for free, because it calls the same `draw()`.

### 5. The body around it

`buildBody` at lod 0 drops its head pieces and takes the lab's shoulder slope into its coat stations (the lab does it in a vertex shader; the real thing is geometry). The far body is untouched.

## What it costs

Per figure, against 4,528 triangles today: about 4,400 at L2 (a little fewer), about 6,900 at L1, about 20,000 at L0. Thirty L1 figures are about 210,000 triangles against 136,000 now, which the GPU won't notice on a desktop; L0 should only ever be the two or three people nearest a standing camera.

Memory: the atlas is about 10.5 MB, 14 MB with mipmaps. A phone (`PHONE_TIER`) loads a half-size copy (3.5 MB) and never uses L0.

CPU: the instance record grows by about six floats, and the level is picked off the pixel height `drawActorFigure` already works out.

## Phases

| phase | work | check |
|---|---|---|
| 1 | Move the head generator into the client as a pure module with level settings; the lab imports it from there | vertex budget per level, closed meshes, the hair edge above the hairline, all in Node |
| 2 | Bake head and neck matrices per frame alongside the vertices | across every frame of all eight clips a head placed by the matrices keeps its neck's base inside the collar and clears the chest |
| 3 | Rewrite the painter to masks; Modelshop bakes the atlas PNG | atlas size; the same token always gets the same face; no record carries a token or an id |
| 4 | The head program in gl/actors.js, levels by pixel height; drop the near body's head pieces | `shapes:smoke`; `__glActors()` with the mesh on and off, from the cab and the standing camera |
| 5 | Shoulder slope in `buildBody`; docs | the far body still stands within 0.03 m of the near one |

Phases 1 to 3 change nothing a player sees: the matrices and the atlas sit unused until phase 4 draws with them. The body's head pieces come out in the same change that draws the new head, never before.

## Left out

- **Order dress.** Wildblood marks, Ascendant implants, hoods and caps exist in the lab because it dresses people by district. The game's figures carry no order, and dressing them by the NPC's own order would be the identity leak above. District dress needs its own decision first.
- **Players' own faces.** Players are drawn as tokens like everybody else.

## Open questions

- Whether L0 is worth having at all, given only the standing camera and free look reach it.
- How many layouts: 32 is a guess at enough variety on one street.
- How the four masks pack into RGBA so a mipmap at street distance still reads as a face and not as a smear of lip and eye colour.
- Whether the neck holds in the smoking and phone clips, where the head pitches furthest. The lab has only been looked at in idle and walk.
