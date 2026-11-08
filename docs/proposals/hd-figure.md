# The close-up figure

**Status: built.** One generator ([figure.js](../../client/game/js/panels/figure.js)) makes everybody drawn as a person: the close-up figure the Room Stage draws ([gl/figure-hd.js](../../client/game/js/panels/gl/figure-hd.js)), and the street's crowd body, which [actor3d.js](../../client/game/js/panels/actor3d.js) bakes from the same clothes sampled coarsely. The Figure Lab (`/figure-lab.html` in the Modelshop) shows it in the Room Stage's own renderer.

## Why

The street figure's body was a coat-shaped loft with lumps for hands, and the Room Stage drew it at arm's length with the old ellipsoid head. Up close it read as a mannequin in a sack. The close-up figure is a body with muscles under separate clothes, hair cards and the street's faces, drawn the way Borderlands draws people. The crowd wears the same clothes so a person seen from the cab has the silhouette they have across a room.

## The generator

Units are the bake's bind space: metres, Y up, facing +Z, the left hand on +X, the arms hanging straight down. The skeleton is the street figure's 19 bones (`FIGURE_BONES`), so the close-up figure plays every street clip.

- **The body** is five vertical lofts (torso, two arms, two legs) through measured stations (`FIGURE_STATIONS`), with the muscles laid on as relief along each section's normal: pectorals, collarbones, abdominals, the groin's line, the spine and erectors, shoulder blades, lats, glutes, the deltoid, biceps, triceps, elbow, forearm, the thigh's teardrop, kneecap, calves and ankle bones. The relief is broad on purpose: a cel shader turns a bump into a band edge, and a lump smaller than a band reads as noise. Hands have four curled fingers and a thumb; feet are shaped.
- **The clothes** are separate shells. A ring of cloth is the convex hull of the slice under it (so it spans the spine's groove and the gap between the legs), eased out, then draped top to bottom: it can't come in faster than `drape` metres a metre fallen, so a coat hangs from the chest past the waist and a trouser leg runs straight from the thigh. A layer hulls the layer under it, so a coat's skirt goes over the trousers. Skin a garment covers is dropped, which is also what stops a bent elbow poking through a sleeve. Edges fold back on themselves for a thickness, and cloth seen from inside draws as its lining.
- **The cuts** (`FIGURE_CUTS`) are a long coat, a jacket and a tee, all over trousers and shoes. A person's cut comes off the outfit's `rand` (slot 17, `figureCut`), as their colours do. The coat's and the jacket's front edge, the overlap's shadow and the buttons are drawn in the shader from bind-space position, not built.
- **The hair** is actor-head.js's shell, which the crowd's head wears too, with cards over it close up: strips rooted above the hairline, combed and hung by style, cut into strands and alpha-tested by the shader so nothing needs sorting. A card whose root corners fall under the hairline is dropped, and no corner may cross the face. Cards are lit with the head's volume, not their own flat face, and the ink leaves them out.
- **The head** is actor-head.js's L0 (L1 on a phone) in the `comic` face style (`FACE_STYLES`): a heavier brow, the nose's bridge and tip kept, a firmer chin and a slightly wider jaw, with the fine relief cut back because the inked atlas draws it as lines. The street's head keeps the `real` style.

| level | used by | vertices (coat, no cards) |
|---|---|---|
| `hd` | the Room Stage, the Figure Lab | about 15,000 to 18,000 with cards, 32,000 budget |
| `lite` | the Room Stage on a phone | about 5,000 |
| `crowd` | the street's near body (actor3d.js) | 1,732, against the old body's 1,832 |
| `far` | the street's far body | 228, plus its old head |

## Drawn in the comic manner

The close-up figure is always drawn in the house's comic look ([comic-ink.md](comic-ink.md)), whatever the Cel Shading setting. A cel figure with a painted, glossy face is what read as uncanny, so:

- the face is the inked atlas (`createFaceAtlasFeed({ ink: true })`);
- light is the comic light ([gl/comic-light.js](../../client/game/js/panels/gl/comic-light.js)): lit or in shadow by the side of the key light (the lamp while it's on, else the window) the surface's FORM faces. The form normals are each part's normals diffused until only the big forms are left (`formNormals` in figure.js, baked at the close-up levels and held within about 70° of the surface's own, so a finger doesn't light from behind). So a head or a limb takes one clean shadow shape, with a crisp antialiased terminator a little past side-on. The shadow is about half the light, moved toward `HOUSE.shade`'s painted violet, darkest in a core just past the terminator and lifted on the far side by bounce. Small forms only shade gently within each tone, and a thin rim lifts a silhouette in shadow. The lit tone still follows the room's lamp and the hour. The first version stepped the light against every surface's own normal with an ink line along the turn, and every nose, fold and muscle threw its own hard island;
- skin is matte, and only leather, gloss and metal keep a highlight, a hard one;
- every figure gets the house outline, weighted under the light.

The outline is set back 2 cm along the eye's ray in world space, not by a constant in clip space as the room's own ink is. A clip-space bias shrinks with the square of the distance: the room's 0.0004 is centimetres on a far wall and 3 mm on a face at arm's length, which let the outline come through the shadowed side of a face.

## In the Room Stage

`figurePeople` (gl/room-people.js) turns each visitor into a record: their look off their id through `actorOutfit`, their clip's pose from `actorSkinAt`, dropped so the lowest sole point is on the floor, and placed standing, sitting or lying. Each bone's 3×4 transform goes straight from bind space into the room, so gl/figure-hd.js skins on the GPU with 19 bones as uniforms and needs no palette texture. The room's light is a shared chunk ([gl/room-light.js](../../client/game/js/panels/gl/room-light.js)), so a person stands in the light the chair beside them does. A mesh is built once per cut, hair style and level, the first a beat after the room opens.

`peopleBatch`, the crowd's body posed on the CPU, is kept for the Figure Lab's "crowd body beside".

## The Borderlands pass

After a style report (2026-11-03) asked for stronger shapes, gear and painted detail at much the same triangle count, the figure moved toward Borderlands' people. Most of it is paint and small pieces of gear; detail was given up where shape and line read better.

- **Proportions.** A narrower waist under a fuller chest (`TORSO`), squared shoulders on tops and sleeves (each cut's `shoulder` ease), hands at 1.18 (`HAND_K`), and the comic head harder in the cheekbone, chin and jaw (`FACE_STYLES.comic`). The face keeps its form normals from 10 passes of the diffusion rather than 40, so its planes hold.
- **Boots and a belt.** A boot's shaft over the trousers' foot to 0.235 m (`BOOT`), so trousers read tucked in, on a chunkier shoe whose sole line the walk still pivots on. A belt over the outermost layer at the waist (`BELT`), and a belted coat or jacket is cinched to it (`cinch` in `clothRings`, applied after the drape). The crowd wears both.
- **Collars.** Taller and flared, open lower at the front so a bowed head clears them (`collar.open`).
- **Gear, close up.** A bandolier from the left shoulder to the right hip laid on the outermost layer, a pouch on the belt, knee pads, and fingerless gloves (paint on the hands). Each is picked off the outfit's `rand` (`figureGear`, slots 18 to 22) and is part of the mesh's key (`figureKey`); the gear's leather, the pads and the gloves take their colours from short lists in gl/room-people.js.
- **The paint** (gl/figure-hd.js `paintCloth`), in bind space, so it costs no triangles: the yoke, chest pockets with flaps, side and sleeve seams, cuff and hem bands, elbow creases, a coat's waist pockets, trouser seams, cargo pockets and knee panels, boot soles, welts, laces and collars, the belt's buckle, the strap's stitching, wear at hems, cuffs, toes and on the gear, and a broad brushed value over all the cloth. A vertex's aux says which piece it's on (`FIG_PIECE`). A line is always darker than its cloth (the house ink, or a third of a dark cloth).
- **Hair cards** are two or three chunky clumps each, tapering to points, inked round the edge with a stroke of light down them.

## The face's planes

Two art-direction reports (2026-11-03) asked for Borderlands' faces: a strong jaw, a defined brow and cheekbones, sharp lines, and a silhouette that reads at every distance. Head on, the faces also showed a small dark moustache. Both came down to how a face is shaded and inked, so the fixes are shared by every close-up head: the Room Stage's, Deadball's, the rink's and the street's.

- **The moustache** was the face painter (tools/modelshop/face-masks.mjs) and the light together. The painter laid a 2.4 cm shadow band under the nose, near-black nostrils, and ink folds from the nose to the mouth's corners that framed the mouth line; and lit off the real nose, a key from above put a dark band under the tip. The shadow is now under the tip only, the nostrils are small and light, and the folds are short creases off the nose's wings that stop clear of the mouth.
- **Designed planes** (form-normals.js `faceDesigned`). A comic face's shadows are shapes on planes, not its real curvature, so the face's normals are bent onto them: the brow's underside faces down (the sockets), the cheekbone's top up and the hollow under it out and down (the wedge down the cheek), the nose has two side planes (its shadow on one side), only a sliver under its tip faces down, the jaw's underside faces down, and the upper lip is held facing forward, so it's always lit. The field is smoothed three passes, so the terminator doesn't step along the mesh. The Room Stage's figure lights its face's form normals with it; the park's, the rink's and the street's heads draw one normal a vertex, so theirs lean 85% onto it (`faceLeaned`).
- **The head's shape** (`FACE_STYLES.comic` in actor-head.js): a sharper brow shelf (`browEdge`), higher, fuller cheekbones (`cheekHi`), a wider flat chin (`chinW`), and a corner at the jaw's angle (`jawSq`), so the head reads square from the front and in profile. The street's `real` head has none of them.
- **The inked atlas's lines**, after the reference: a heavier upper lid, the crease off the cheekbone, a short line under the eye, a furrow between the brows (deeper on a sterner face), and darker, more solid brows. `npm run actors:faces` re-bakes both atlases.

**Lines at every distance.** The silhouette carries through every level, because the crowd's body is the close-up clothes sampled coarsely: the shoulders (more on every cut), the belted waist, trousers that now follow the leg (`hug` 0.38) and a rolled cuff resting on the boot read the same from the cab. The close-up figure is always outlined, held to at least 1.8 px; the painted line work is heavier (a 1.4 mm half-width) and fades only where it would be smaller than a pixel. The street's people are always outlined too (2026-11-03), comic look or not: gl/actors.js draws every body and head first in ink, pushed out along its normals by 14 mm on the screen held between 1.2 and 3 px of a 900-tall picture and set 3 cm back along the eye's ray (`OUTLINE`), then lit over it; the depth prepass the city's own ink reads skips it. Only the billboard under 1.5 px goes without, where a line would be the whole figure.

**The park under the comic look** adds its lamp banks smoothly and steps once on their sum, and its bank and sun shadows are looked up further off the surface and stepped softly: stepped light by light, and hard-stepped on maps coarse at a close shot, a face under the banks broke into blocks.

## More cuts, and the Wildblood

**The city's cuts** (`FIGURE_CIVIL_CUTS`, picked off the outfit's rand) are the coat, the jacket and the tee, then:

- **a hoodie**: its hood down, bunched behind the neck (`hood`), drawstrings laid down the front, a pocket across the belly, and a knitted rib at the hem and cuffs that the cloth is cinched to (`rib`, a cinch in `clothRings`);
- **a bomber**: puffed (ease 0.024), cinched into a ribbed waistband, zipped, quilted in diamonds, with a patch on the left sleeve;
- **a duster**: to the calf (0.42), with a capelet over the shoulders (a `mantle` piece to 1.24) and a vent up the back;
- **a vest** over a shirt: the sleeves and collar in the shirt's own colour (`FIG_SLOT.shirt`), a V of shirt at the chest, welt pockets and buttons, all paint.

A cut's `front` says how the paint closes it (`FRONT_KIND` in gl/figure-hd.js). The cuts' order is their index in the shader, so new ones are appended.

**The Wildblood** ([lore-wildblood.md](../lore-wildblood.md)) dress as the Thornwarren does at home, which is domestic, so there are no masks:

- a sleeveless **tunic** with a ragged hem (`jag`) and a woven band over it, and an ash handprint over the heart (a handprint in ash is the wearer's own);
- a ragged red **mantle** over the shoulders and both arms, cut to a point front and back (`point`), with the tally over the heart in ash: a stroke for each Gift, a ring for each Lesson, the rings bigger;
- linen **wraps** on a forearm and both shins, **marks** in their pigment on the face (one of four patterns) and the backs of the hands, the order's palettes for the cloth and hair, skin tinted and eyes gone amber;
- **changes**, one or two a person (`body` in `buildFigure`): a mighty arm (its sections and hand scaled, so the cloth hulls it too), a thornhide right forearm (thorns, and bark plates parted by cracks in the paint), horns from the brow, claws, a necklace of teeth laid on whatever is outermost, and salvaged goggles up on the brow in Halcyon blue, the only blue a Wildblood wears.

An NPC of the order is dressed so in a room: plugins/roomstage sends an NPC's `order`, and `dressOf` in gl/room-people.js maps it. The room already names everyone over their heads, so the dress tells a viewer nothing the tag doesn't; the street's figures still carry no order, for the reason in [street-figure-heads.md](street-figure-heads.md). Players aren't dressed by their order yet.

The Figure Lab's `dress`, `changes` and `cut: one of each` show them.

## The sports' people

Deadball's players and the CPhL's skaters have their own bodies, built for how they're seen. Measured on 2026-11-03:

| | Close-up figure | Deadball player | Rink skater |
|---|---|---|---|
| Triangles a body | about 28,000 | 14,400; 27,400 at the comic look's near level; 7,700 and 3,200 far | 5,700 to 8,100 close up (level 2); 2,200 to 3,300 near; 800 to 1,500 far |
| Built | once, GPU-skinned | once, GPU-skinned | on the CPU, every body, every frame |
| Closest use | arm's length in a flat | the broadcast's close-ups | a fight; the winner's head and shoulders at 9 ft |

Brought to the same level, within reason:

- **Every close-up face is the same.** The park's players ([gl/ballplayer-mesh.js](../../client/game/js/panels/gl/ballplayer-mesh.js)) and the rink's heads ([gl/arena-heads.js](../../client/game/js/panels/gl/arena-heads.js)) use the `comic` head and the inked atlas always, as the Room Stage does. Caps and helmets fit the comic skull (`skullPoint(..., 'comic')`), and the goalie's mask is moulded round it. The rest of each view keeps following the Cel Shading setting.
- **Deadball's bodies were already at this level** (shaped kit lofts, deltoids on the collarbone, cleats, gloves, a bat grip, the kit atlas), so their bodies are unchanged.
- **The rink has a third level** for bodies whose head is over 64 px on screen ([gl/arena-mesh.js](../../client/game/js/panels/gl/arena-mesh.js) `buildBody`, picked in gl/arena.js). It has everything level 1 has, plus profiles refined between their stations on a Catmull-Rom curve, 30 sides to the sweater with a squarer section (`loft`'s `pw`), 18 to a limb, 16 to a tube, and a finer shoulder pad and helmet. Only the few bodies filling a close shot get it; the 14 men are still rebuilt every frame, so the broadcast's wide shot costs what it did. [arena-smoke.mjs](../../scripts/shapes/arena-smoke.mjs) budgets level 2 at 12,000 triangles, 11,000 for a goalie.

Under the comic look the sports' people and the rooms take the same comic light as the close-up figure ([comic-ink.md](comic-ink.md#the-comic-light-as-built-2026-11-03)), the sports' heads with their normals leaned onto their form.

Not done: an official's stripes stop at his shoulders (only the torso carries the jersey texture), and the rink's shoulder pads are plain caps of the jersey's colour.

## What else changed

- **The shoe sole is a rocker** (`shoeSole`): flat under the ball, the old crowd shoe's curve to the toe, rounded at the heel. The root solve pivots on that line (`figureSole`), not on six points along a flat one, and it pins whichever sole is lowest rather than the foot with the lower ankle. With the old rule, in double support it pinned the leading heel while the trailing toe was still the lowest thing on the body, and the toe slid.
- **The walk lifts the ankle 7° in late swing**, not 4°, so the flat sole clears the ground; at 4° the ball brushed it, and the solve then pinned a swinging foot.
- **The walk's stride is 1.623 m**, up from 1.517, because the solve now pivots where the shoe actually touches. A walker's phase follows distance (`actorStrideM`), so feet still plant.
- **The crowd stands half a millimetre taller**: `top` is 1.776 m against 1.7755 before.

## Checks

[scripts/shapes/figure.mjs](../../scripts/shapes/figure.mjs) builds every cut, hair style and level. It checks:

- vertex budgets, and that every mesh indexes as UNSIGNED_SHORT;
- finite points, weights summing to one, and bone indices on the skeleton;
- every built part wound outward;
- no torso skin left under a coat;
- card roots above the hairline and no card across the face;
- the sole never under the ground line;
- the crowd's coat within 20 mm of the close-up coat at every height from the knee to the shoulder (16 mm at worst, at the shoulder).

[actors.mjs](../../scripts/shapes/actors.mjs) and [actor-head.mjs](../../scripts/shapes/actor-head.mjs) gate the crowd's bake as before, unchanged.

## The sculpted revision

A revised figure on the same rig is in review behind a switch: [sculpted-figure.md](sculpted-figure.md).

## Open questions

- **The street's own close-ups.** The standing camera and free look still draw the crowd body with the L0 head. Swapping in the close-up figure past some size would mean GPU skinning on the street (gl/actors.js bakes every vertex for every frame), as the ballplayers do.
- **Tying the comic manner to the setting.** The close-up figure ignores the Cel Shading switch. If the plain look is meant to stay a real choice, the figure needs a plain rendering that doesn't read as uncanny.
- **Hatching.** The figure has the comic look's bands, edge line and outline, but not its hatching in deep shadow.
- **More cuts.** Shorts, skirts, hoods and order dress, each a cut over the same body.
