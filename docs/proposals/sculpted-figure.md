# The sculpted figure

**Status: stage 5 of 6, in review.** The revised close-up figure exists behind a `sculpt` switch that only the Figure Lab turns on. Nobody in the game wears it yet. Stage 6 waits for approval of John Akerson.

To see it, open `/figure-lab.html` in the Modelshop, put `npc_john_akerson` in `id`, press Tab so the Lab reads his file, and tick `before / after`. Restart the Modelshop first if it was running before the `/api/npc-figure` route went in. For the weights, tick `sculpted` and `weight` and move the slider.

## Why

An art brief (2026-11-06) asked for people who look like a graphic-novel drawing sculpted in 3D: better shapes, materials and shading, not more detail or more triangles. The rig, the clips and the modular clothes stay as they are.

## What changes

`sculpt` is part of the mesh's key (`figureKey`) and applies on the `hd` and `lite` levels. The skeleton, the weights and the clips are the same.

| | Current | Sculpted |
|---|---|---|
| John's triangles (`hd`) | 32,220 | 22,580 with no gear |
| Hair | shell and alpha cards | shell and solid locks |
| Outline | full weight | half weight |
| Tones | lit and shadow | lit, a middle tone and shadow |

- **The head** is `FACE_STYLES.sculpt`, on the same mesh as `comic`: deeper planes and a little asymmetry (`asym`). The neck is thicker (`NECK_SCULPT`), and the hairline brings a sideburn in front of the ear (`HAIRLINE_SCULPT`).
- **The hair** is `hairLocks` in figure.js: about 35 solid blades in overlapping rows (`LOCK_ROWS`), parted on the left. They take the outline and light as the head's volume.
- **The body** keeps its joints. `partsFor` slims the shoulder and upper arm, and `sculptCut` brings the clothes closer and drops the padded shoulder. Rings are further apart (`SCULPT_DY`), which pays for the hair and the hands.
- **The hands** are `handSculpt`: knuckles, a thumb muscle, and fingers of three bones that vary in length and bend at their joints.
- **The paint** is `paintSculpt` in gl/figure-hd.js and costs no triangles: the jacket's yoke, panels, pockets and open front, folds, worn denim, the beard's shadow, brows and lids. It replaces the bomber's quilting and patch.

## Known limits

- Knee pads are still the old shapes.

- The hoodie, tee, vest and duster have folds but no new construction.
- John's grin is a look, not an expression: it doesn't change with what he's doing.
- Pale trousers are capped at the value of worn denim (`legK` in gl/room-people.js), and hair is darkened to a third. Both apply to anyone sculpted.

## Stage 6

Turning it on means passing `sculpt: true` from `figurePeople`'s callers and setting `ACTOR_BODIES.on`. Before that: a full regress.

## Eyes and skin

The second pass is paint only, so it costs no triangles. The eye is drawn over the atlas's: grey whites shaded from the lid, a flat iris with a dark rim and one catchlight, under a single heavy lid with a flick at the outer corner. The planes are flat shapes in the skin's warm shadow colour (`shape` in gl/figure-hd.js): the socket, the cheek's wedge, the temple, under the nose and lip, the nose's side away from the light, the hair's shadow on the forehead and the jaw's on the neck. Skin is warmer and deeper (the multiplier in `lookOf`), the beard follows the jaw with short strokes along its edge, and deep shadow on skin is hatched.

The nose and mouth are painted too, over a cleared patch of the atlas: a firm mouth line, a thin upper lip, a paler lower lip, and each nostril's wing as a short arc.

The eye is still paint, so it thins in profile. Real lids would fix that for about 100 to 150 triangles an eye.

## Variation

A person's face comes off their id (`lookOf`, rand slots 46 to 51): one of four head shapes (`SCULPT_HEADS`, part of the mesh's key) and `uFaceV`'s brow weight, mouth width, beard and soft flag. A person with a settled look (below) skips the roll.

Each hair style reshapes the lock rows (`LOCK_STYLE`). A crop has no locks and is painted as stubble. Long hair is the rows over the shell's sheet.

The jacket's construction is on the coat, the jacket and the bomber only. Dark skin is lifted less than pale skin is deepened, and takes a hard plane of light, because it reads by its lights rather than its shadows (`darkSkin` in gl/figure-hd.js).

Soft faces go with the woman's builds below. A soft face has its own head and its own paint:

- The head (`sculptSoft`) has almost no brow ridge, a shorter nose, a jaw that tapers to a small chin with no corner, and `chinUp`, which shortens the face under the mouth.
- The atlas's lines all go, because they were drawn on men. Only its eye mask would be left, and a soft face draws its own eye instead: wider, tilted up at the outer corner, with a heavier lash line and a short wing.
- The creases, the cheek wedge, the jaw's cool tint, the hatching and the corner tick at the mouth are off. Brows are one curved arch above the eye, lips are fuller and turn up slightly at the corners, and the blush moves from the nose to the cheek.
- Lipstick comes from the layout's `makeup`, as it does on the street's faces.
- Fine lines on a soft face are kept darker than the skin, because the house line is paler than dark skin.

Age still draws its lines on top. `uFaceV.w` is the switch, so every one of these is a `mix` that leaves other faces as they were.

## Settled looks

An NPC's `flags.figure` (docs/flags-keys.md) settles their look in content: it beats every roll, and whatever it leaves out still rolls. The room sends it with the NPC, and nothing but the sculpted figure reads it. A build, cut or head it names that doesn't exist fails the `figure` gate.

John's comes from the Tonight Show title card (`content/media_graphics/tonight_show_logo.json`): chestnut swept hair, blue eyes, stubble, the grin, tan skin and the black suit with blue piping. He keeps the base body, because his look gives no `weight`.

Two things exist for him and anyone like him. The `suit` cut is a jacket over a shirt, with the lapels, tie and button painted; nobody rolls it. `smile` paints a grin over the mouth and redraws the lines round it, and because the atlas's lines don't move with it, they go. It's a look, not an expression, so he grins whatever he's doing.

## Weight

A body's weight is one scale from 0 to 1 (`somaOf` in figure.js): ectomorph at 0, mesomorph at 0.5, endomorph at 1. Each of the three is its own set of stations (`SOMA_TORSO`, `SOMA_ARM`, `SOMA_LEG`), not a stretched copy of another. They share the base tables' heights and the mesh's topology, so a weight between two is the two sections mixed, on the same joints, and the triangle count doesn't change.

- **Ectomorph:** narrow shoulders and hips, a flat chest, a straight waist, thin limbs, the ribs and collarbones in the relief, and a hollow face drawn in below the cheekbones.
- **Mesomorph:** broad shoulders, a deep chest over a narrow waist, thick arms and thighs, the muscles' relief pushed up, and a heavier jaw. It's a muscular body, not an average one.
- **Endomorph:** sloping shoulders, the weight on the belly, hips and thighs, thick upper arms, a fold under the belly, soft forms with little muscle showing, a round face and a second chin.

Weight multiplies with the build, so a woman has all three. Her waist narrows most as a mesomorph, because `waist` says how much of the build's waist each body keeps.

Hip width comes from the tops of the legs, not the torso, so `thigh` moves them in or out from the hip joint. The face comes from `weightedFace` in actor-head.js, which adds `FACE_WEIGHT` to the head's own shape under a name like `sculpt@0.3`. The arms are held off the body by `abduct`, in `stance`, so an endomorph's hands clear the belly.

Bare skin takes the weight in paint as well as in the mesh, because the form normals smooth most of the relief away. `paintBody` in gl/figure-hd.js draws it the way the face is drawn, after Borderlands: each form is one inked contour that swells and tapers, with a flat shadow shape under it and hatching in the shadow's outer part. `uSoma` sets how much of each set shows: the muscles, the ribs and collarbones, or the soft folds and navel. Never shade these softly, and never draw them as even lines: both were tried, and an even line reads as a scar. A woman's chest isn't drawn.

Fitted cloth follows a soft body in (`sculptCut` raises `hug` and `drape` by `fat`), or a tee hangs off the belly like a box.

A person rolls their weight in tenths (slots 56 and 57), most near the middle, and it's part of the mesh's key, so people at the same tenth share one mesh. That's a mesh per weight in use, built when first needed, not a morph on the GPU. A weight can't change on a live figure without building a new mesh.

## Triangles

Measured on 80 rolled people and John, the figure this revises against this one:

| | Before | Now |
|---|---|---|
| John, close up | 32,220 | 30,176 |
| Average, close up | 32,739 | 26,196 |
| Heaviest of the 80, close up | 35,764 | 32,150 |
| John, phone | 10,790 | 10,672 |
| Average, phone | 11,006 | 10,291 |
| Heaviest of the 80, phone | 11,784 | 11,208 |

Nobody in the sample got heavier at the close-up level, and 3 of the 80 did on a phone. The saving comes from replacing the old hair cards and the closer clothes; the eyes, beards and finer hair spend part of it back.

## Levels of detail

| Level | Triangles | Used for | Has |
|---|---|---|---|
| `hd` | about 29,000 | a room, within 3.1 to 3.7 m on a computer | everything: real eyes, beard locks, finer hair |
| `lite` | about 10,000 | a phone, and across a room | the same body and weight, painted eyes, a beard in three wide locks, plainer hair |
| `crowd` | about 3,600 | the street | one baked body, no face of its own |
| `far` | about 430 | the street at a distance | one baked body |

`figurePeople` drops a person from `hd` to `lite` past `FIGURE_LOD.far` and brings them back inside `FIGURE_LOD.near`, so nobody flickers at the line. The Stage builds both levels when it opens. A phone stays on `lite`. Mouth shapes, blinks and weight work at both.

`crowd` and `far` are the street's single bake. Their body types are four offsets a vertex on that one bake (`bk.body`), not a bake each: six bakes would be about 72 MB of graphics memory and several seconds of baking on a phone. The mesh is the same at every weight, so `buildBody` measures how far each point moves along its normal for the ectomorph, mesomorph, endomorph and a woman's build, and the street's vertex shader moves it by `iBody`, the person's mix of those (`bodyOf` in actor3d.js). So any weight is free, and it costs 16 bytes a vertex and 16 an instance.

A street body comes off the street token, like the rest of the outfit, never off the NPC: their real build or sex would be a tracker readable from a street away. So somebody's street body needn't match the one they have in a room. Facial hair isn't on the street, whose heads are the old ones.

`ACTOR_BODIES.on` is false, so the live street doesn't change until the sculpted figure goes on with it.

## Deadball

The players keep their own body, kit and rig: Deadball's bodies were already varied by height, girth and shoulders (diamond/cast.js), and its three levels of detail stand. What changed is the head. `head` in gl/ballplayer-mesh.js takes a sculpted head, shaped off the name with its weight off his girth, lifted and sunk as `FACE_UP` and `HEAD_SINK` are in a room, and `hairMesh` in the sculpted shape.

Its face is `paintManFace` (gl/face-paint.js): the sculpted figure's proportions, planes, brows and mouth in one function for renderers working at broadcast distance, so no atlas, real eyes or speech. Facial hair comes off the layout's beard: stubble, shadow, moustache, goatee or trimmed. The eye black and the blink carry over. A face and bare skin go deeper into shadow than cloth under the banks. The head's and a helmet's ink sits further back than the body's, or the shell comes through beside the nose and in steps across the crown. `paintManFace` works in linear colour, and the park's head shader is in sRGB until its last line, so it converts on the way in and out; without that every shadow lands far too dark and orange.

The uniform takes the sculpted figure's manner too. `kitForms` in gl/ballpark.js draws the cloth's big folds on the man in his bind pose, so they go where he goes: pulled from the armpits, bloused over the belt, at the sleeve and the undershirt's elbow, the crotch, the knees and the blouse over the socks. Each is an inked line that tapers, with a flat cool shadow beside it, and they stop once a fold is under a pixel or so. The buckle is satin, because a metal mirror that size shows the whole outfield.

The gear, close up:

- **Caps:** the shell stands off the skull more at the crown (`capLift`), and the bill runs forward and stops at the temples. Let it wrap or droop and the cap turns into a pith helmet. Seams are strips of their own, because a colour on the shell's vertices smears into a wedge a column wide.
- **Gloves:** a colour on the `leather` key goes through `onLeather`, which divides out the texture's own tone. Multiplied straight, every glove came out black. A catcher's mitt has its own paler pocket and a thin rolled rim.
- **Shoes:** laces and the cleat's stripe are strips on the upper, at the top level only, for the same reason as the seams.
- **Masks:** thin bars in a heavier frame, held on by a harness round the back of the head. The throat guard tapers.
- **Umpires and the crew** wear a shirt collar (`shirtCollar`) that closes the jersey's neck hole up to the neck.
- **Faces under the banks:** a head looks further off its surface for the banks' shadow, or its own shadow lands on the cheek as a ragged patch. Eye black is a thin stripe well under the eye, or it reads as a second one.

## Real eyes

At the close-up level an eye is a ball and two lids (`eyeParts` in figure.js), about 1,000 triangles a head. A phone keeps the painted eye, which it can't afford otherwise, so both paths live in the face shader behind `uRealEye`.

The skin isn't cut: its shader discards the opening (`eyeHole`) by the same curve `EYE` gives the lids. Behind it is a flattened half-ball, set as far back as it has to be never to come through the skin round it, wide enough to fill the opening's corners. That's what gives the eye depth from the side. Change `EYE`, and the `eW`, `eT`, `eB` and tilt in the face shader with it.

The lids are thin strips with real thickness along the top and bottom of the opening. A lid's uv says whether it moves and how far, and `mouthMorph` moves the upper one down in a blink while the hole closes behind it. Its dark underside is the lash line, so neither the eyes nor the lids take the ink outline.

The iris is painted on the ball in the ball's own radii, so `uGaze` turns the eye without moving a vertex. The eyes settle on something for a couple of seconds and flick to something else, off the id and the clock; `body.gaze` overrides that.

## The face against the guide

The art brief's guide is the bar for a man's face, so read this before softening one. Nothing of the atlas is left on a sculpted face: every line and plane is drawn in gl/figure-hd.js. The atlas's lines were painted to read at street distance, and close up they look like scratches. `m` is still sampled, but the sculpted branch overwrites it.

- **Shadow:** on a man's skin the third tone sits higher and darker (`hardF`) and the unlit side goes deeper, so the face looks carved rather than lit from the front. A soft face keeps the gentle values, and dark skin mostly does, because it reads by its lights.
- **Eyes:** real at the close-up level (below), set back in a socket drawn in `deep`, which is greyer than `shape`. The warm shadow read as orange eyeshadow there. A man's eye is narrow and level under a heavy lid, and the lid cuts the top of the iris.
- **Proportion:** a man's brows sit right on the eye, low at the nose and angled in, and stop short of the temple; that does more for the expression than any shading. His eyes are closer together (`EYE` in actor-head.js), his nose narrow at the bridge and full at the tip, his face shorter under the mouth (`chinUp`), and his mouth wider. His face is widest at the cheekbones, and the jaw runs in straight planes from a corner by the mouth (`jawY`) down to a modest chin. A corner at chin height makes a box, and it went cartoonish when it did. `HAIRLINE_SCULPT` is lower than the street's.
- **Form:** `sculpt` has a heavier brow, a longer straight nose and a stronger chin brought forward (`chinOut`). Check a change in profile; that was the weakest angle.
- **Thirds:** hairline to brow, brow to the base of the nose, and nose to chin should be about equal. The head's landmarks made the middle one far too long, with the nose low, and everything painted is pinned to those landmarks, so `faceLift` in the vertex shader lifts the face from the nose down after the paint's coordinates are taken, and the paint goes with it. The head sinks by the same again (`FACE_UP`), so the chin stays put on the neck.
- **Neck:** `HEAD_SINK` in gl/room-people.js sets the head 16 mm lower on the neck, on the posed bone, because the head's joint can't move without moving every clip.
- **Lines:** few and short. Long lines from the nose to the mouth, across the forehead or down the cheek age everyone by twenty years; leave those to `uAge`. A cheek shadow is one rounded wedge under the bone: an ellipse there reads as a disc, and a straight edge as a patch.

Skin, hair and ears go on from there. `skinPaint` lays brushwork, grit and pores on a face, neck and bare limbs, which give out before they'd turn to grey noise at a distance. Spiky hair has finer locks beside each main one and short points lying forward over the hairline, and every lock carries soft painted streaks (hard strand lines draw a maze on pale hair). Neat and long hair keep the plain locks. The hairline itself breaks into points across the front only: round the ear they read as a zigzag. The ear's rim, inner fold and bowl are drawn in metres from its middle.

A heavy face puts its fullness at the cheek (`fat` in skullPoint, centred on 1.6 m), not the jaw, or it goes pear-shaped. It keeps the jaw's width, loses the cheek wedge, and sits lower on a short neck.

## Facial hair

A man rolls one of twelve looks off his id, and `flags.figure.facial` settles it (`FIGURE_FACIAL` in figure.js): clean, stubble, shadow, moustache, goatee, vandyke, soulpatch, chinstrap, sideburns, trimmed, full and long. All but two are painted, so they cost nothing. Each area is a distance on the face, and the nearest of them is drawn over a contact shadow with a ragged edge and streaks running down. Facial hair stops at the lips, which have to stay clear to move.

`full` and `long` add locks along the lower jaw at the close-up level (`beardLocks`), so the beard shows in the outline, over the painted one. The lite level has three wide locks in their place, one mass with the same outline, because a few narrow ones read as daggers. They're part of the mesh's key. They ride the head bone, so `mouthMorph` takes them with the jaw by their slot: without that a beard would stay put while the chin drops through it. Keep the locks long and thin. Short wide ones read as pinecone scales, and any rooted up on the cheek flare out like a ruff.

## Poses

Hands rest on the lap in every seat. The arm angles (`ARM_AT` in actor3d.js) are solved against the skeleton for a wrist, an elbow and a fingertip, so aim them at the surface, not by eye: the thigh's top is about 0.58 m seated. On a wide body the arms held off for `abduct` drop to 30% in a seat, or the hands leave the lap.

With nothing else to do, somebody in a Room Stage plays a clip off `ACTOR_IDLES` for each ten-second slot, picked from their id and the clock (`idlePlan` in gl/room-people.js), and goes from one to the next in about a second, mixed on the pose (`actorSkinMix`) so an arm swings round rather than through the body. It costs no state and everybody is on their own slots. There are 15 standing clips and 5 seated: shifting weight, looking over a shoulder, a hand on a hip, hands in pockets or behind the back, arms folded, scratching the head, rubbing the neck, checking a watch, stretching, yawning, sighing; and on a seat, resting, hands clasped with a heel tapping, leaning forward, leaning back, arms folded. None are baked, so the street pays nothing. They play on every figure in a room, sculpted or not; only the hands on the lap reach the stadium's fans.

What they idle at follows what the text game says about them. `ACTOR_IDLES` has a list for each state and each kind of work, and the server sends which applies (plugins/roomstage `peopleIn`):

- **Lying awake:** on the back with the hands on the belly and a knee coming up, an arm over the eyes, a phone held up, on the side.
- **Asleep:** curled on the side, or on the back with the head turned and the mouth open, held 45 seconds at a time so a sleeper turns over now and then. In a chair, dozing with the head dropping and jerking up.
- **Out cold** (`dosedOut`): sprawled with an arm flung out, or slid down a chair.
- **At work:** a barkeep wipes the bar, polishes glasses and leans on it; a shopkeeper leans on the counter, counts money and writes; a guard stands with the feet apart and the hands together, or arms folded. Somebody living rough shivers, scratches and coughs.

The ones on their side roll over in the pose itself (`onSide`, a quarter turn of the pelvis), not in the placing, so turning over blends like any other move. A lying body is laid with its feet where `placeOf` puts them, without the sole drop a standing one gets, or a knee drawn up would slide the whole body up the bed.

An emote line acts itself out. `npc-bubbles.js` passes every line that isn't speech to the Stage (`npc:line`), which finds whose name it starts with (`speakerOf`), and client/shared/npc-acts.js turns the rest into an act: "wipes down the bar" is `wipe`, "nods off" is `doze`. `ACTOR_ACTS` gives the act's clip standing, sitting or lying, and it plays from the top of its cycle as the line comes in, for a couple of cycles over the idle, or once for a clip that plays once. Joined at a random point, a laugh could land on the part of its loop where the arms are down. It costs the server nothing, and every source of emotes gets it: chitchat, home activities, the bartender, npc-life's own remarks. There are no props, so the hands mime what they hold. The figure gate holds a list of lines the game prints to the acts they should give; add to it when you write a new kind of emote.

## The mouth and lip sync

The sculpted mouth is one drawing for every shape it can be in (`THE MOUTH` in gl/figure-hd.js): the upper lip with its bow, the opening, the lower lip with a stroke of light, and inside it the teeth with a line between each, the lower teeth and the tongue. Everything is measured from the corners in, so it closes up at any width. Only the middle of a line carries ink; lips are two flat tones.

A man's mouth is firm and thin, and it's shaped by shadow, not colour. His lips are hardly redder than his skin, the upper one in shadow. The line between them isn't straight: it dips at the middle, rises each side of that, falls to the corners with one corner a touch higher, and thins to nothing. The crescent of shadow tight under the lower lip does most of the work. A straight even line with pale lips looks like a stick on a pill.

A shape is six numbers (`MOUTHS` in client/shared/lip-sync.js): open, wide, round, pressed, teeth, tongue. There are 15 shapes, after the animator's mouth chart. The first three also move the mesh: `mouthMorph` drops the jaw and spreads or purses the lips in bind space before the skin, in the body and its ink alike, so the chin and silhouette move and no triangles or bones are added. The mouth is painted in those moved coordinates (`vMouthP`), and the rest of the face in the unmoved ones.

`speak()` in the audio engine reports each phoneme and when it starts (`opt.trace`), so `say` in npc-bubbles.js sends an `npc:voice` event with the voice's own timing and the Stage plays it (`mouthTrack`, `mouthAt`). Shapes lead the sound by 40 ms and ease over 85 ms. A diphthong is two shapes. With the sound off there's no trace, and `textTrack` reads the letters at speaking pace instead. A settled `smile` gives way to the sounds being made and comes back between them.

Blinks are a pure function of the id and the clock. A clip can set the face too (`face` in ROOM_CLIPS): the yawn opens the mouth and shuts the eyes.

Only the sculpted figure has any of this. The current figure's mouth is in its atlas, and stays shut.

To try it, tick `sculpted`, type a line in `say` and press Enter, or hold a shape with `mouth`.

## Builds

`SCULPT_BUILDS` in figure.js are who a body is, on the same 19 bones: average, older, hunched and woman. A build scales the torso, arm and leg sections and adds relief to the front, and the clothes hull what's under them, so every cut fits every build. A person rolls one off their id (slot 52), and it's part of the mesh's key.

How heavy they are is separate: see Weight below.

Stance is laid on the posed bones (`stance` in gl/room-people.js), so it holds through every clip: `hunch` bows the back from the chest and brings the head most of the way back up, and `abduct` holds the arms off a wide body so the hands clear the hips.

The room sends an NPC's `sex` and a player's `biological_sex` (`peopleIn` in plugins/roomstage), so a woman always takes the soft head and the woman's build, and a man one of the other three heads. Anybody with neither rolls all four. Age is its own roll (`uAge`): grey hair and painted lines. Long hair on the sculpted figure is blades that root on the crown, run back over the skull and then fall, instead of the shell's sheet. They ride the head bone, so they can pass through a shoulder on a turned head.
