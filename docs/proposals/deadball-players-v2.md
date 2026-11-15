# Deadball's players, second edition

**Status: phase 1 started (2026-11-14), off by default; the rest is design.** The close-up figure hangs on Deadball's rig and draws in the park behind `PARK_FIGURES.on` (the Pose Lab's "figure body" box), with the old body as its fallback; the kit's lettering, the belt, hair under the cap and the figure's own shadows are still to do (section 1). The decisions table records what David has settled.

The players [deadball-glass2.md](deadball-glass2.md) put in the park are lofted tubes round Deadball's own rig. They play every clip, but up close they read as mannequins: hands are mitts, every batter gets ready the same way, every pitcher throws from one of three slots, and the First Generation's augments and mutations are blobs and rings in their order's colours. This plan rebuilds the players as athletes, with each man recognisable by the way he moves.

## Decided

| Question | Answer |
|---|---|
| What the body is built on | ROOM's close-up figure ([figure.js](../../client/game/js/panels/figure.js)). One generator draws everybody, and a uniform is a clothing cut. |
| How real | Real athletes' proportions, cloth and muscle, drawn in the house comic ink ([comic-ink.md](comic-ink.md)). |
| First Generation | Each order looks different. Ascendant work is seamless and surgical, Null work bolted on and crude, Wildblood grown into the skeleton, and Long Watch work is ritual and minimal. |
| Release point | A pitcher's delivery is data, and the server's sim reads it. |
| The league | All men. First Generation players whose names read as women's get new names (see open questions). |
| At-bat routines | Composed per man from a library of parts, settled by his name. First Gen players and named stars also get hand-keyed signatures. |
| What varies from man to man | Stance and swing, how he wears the kit, his gear and accessories, chewing, and his face at the big moments. |
| Bat flips | Each man has a flip style and a temperament, and the temperament decides when he flips. First Gen flips are specific to the order. |
| Renames | All twelve First Gen names that read as women's are renamed (see the table under section 7). |
| Four Arms | Uses both pairs: the lower hands barehand what the glove can't reach, brace a dive, clap and point, and all four grip the bat. He gets clips of his own. |
| The grip close-up | A live tell. The broadcast shows it now and then before a pitch, and the booth can call it. |
| Who else in phase 1 | Umpires, coaches and the grounds crew. The athlete build is planned so the CPhL's skaters can take it up in a later project. |

## What's there now

- **Body:** [ballplayer-mesh.js](../../client/game/js/panels/gl/ballplayer-mesh.js) lofts a torso of rings and tubes down the limbs round the 22 bones of [diamond/rig.js](../../client/game/js/panels/diamond/rig.js), and the GPU skins it with four weights a vertex. The head is the street figure's, with the painted face atlas.
- **Hands:** a hand round the bat is a ridged cylinder. An open hand is a palm with four stiff tubes. There are no finger bones, in Deadball or in the close-up figure, whose sculpted fingers ride the hand bone whole.
- **Motion:** 116 clips under `content/animation_clips/`, keyed in the rig's pose language (wrists, ankles, elbow and knee poles, spine angles) and baked by `npm run clips:bake`. `vary` in [diamond/anim.js](../../client/game/js/panels/diamond/anim.js) gives each man his leg kick and stance width. A pitcher's arm slot is one of three clips (`side` 15%, `three` 45%, `over` 40%), chosen by the hash of his name. Batters share the routine clips (`bat_dig`, `bat_gloves`, `bat_helmet_tap`, `bat_plate_tap`, `bat_point`). A let-go bat flies, lands and skids ([loose-bat.js](../../client/game/js/panels/diamond/loose-bat.js)).
- **First Generation:** [deadball-gen1.js](../../client/shared/deadball-gen1.js) gives each of the 32 a list of gear names, and `gen1Gear` builds each part from blobs, rods, cuffs and rings. Four Arms' second pair has no bones, and Hopscotch's hind legs are a shape on ordinary legs. `gen1Fx` in [gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js) lights them.
- **What already exists to build on:** the close-up figure's muscle relief, sculpted hands, layered clothes and solid hair ([hd-figure.md](hd-figure.md), [sculpted-figure.md](sculpted-figure.md)); its grown bones and `MUTATION_LOOK`, which draw the game's real mutations (`content/mutations/`, 56 of them); the augment catalog (`content/augments/`, 11 of them); and the expressions system ([systems-expressions.md](../systems-expressions.md)).

## 1. The athlete body

The close-up figure gains an `athlete` build and a baseball cut. Deadball stops building its own bodies.

- **Proportions from measurement.** Each position gets a build table from real players' height, weight and segment lengths (a row in the [bibliography](../reference/bibliography.md) when it's sourced): pitchers tall with long levers, catchers thick through the thighs and seat, middle infielders wiry, corner bats heavy in the chest and forearms, a veteran's softer middle. `buildOf` in [cast.js](../../client/game/js/panels/diamond/cast.js) grows from three numbers (girth, shoulders, belly) to a set the figure reads: height, shoulder breadth, chest depth, waist, seat and thigh, forearm, neck, and belly.
- **The skeleton (as built).** The figure hangs on Deadball's own rig instead of the clips moving to the figure's. The park solves a pose as it always has, and [diamond/figure-rig.js](../../client/game/js/panels/diamond/figure-rig.js) turns the solve into the figure's bone rows: each figure bone follows the Deadball bone that does its job, axis for axis, stretched along it to Deadball's length (Deadball's man has legs about 9% longer than the figure's) and scaled across it by his size. Every row takes the figure's joint to Deadball's, so the 116 clips, the IK and anim-smoke are untouched. The head goes exactly where ballplayer-mesh.js puts its own, so the caps, helmets and masks grown off that skull still fit. The gate is `scripts/shapes/figure-rig.mjs`: every clip, sampled through at two heights, every joint and the head within a hundredth of a foot, and no row mirrored.
- **What he wears over it.** ballplayer-mesh.js builds a man in two halves (`look.part`): the body the figure replaces, and the gear it wears (the cap or helmet, the mask, the catcher's gear, the glove, the bat, a First Generation man's parts). In figure mode the park draws the gear on its own palette and the figure from [gl/ballpark-figures.js](../../client/game/js/panels/gl/ballpark-figures.js), in the park's light (the sun, the towers and the sky as the room light's lamps and ambient, `uStreet` 3 handing the float target linear light). The jersey is figure.js's `jersey` cut.
- **The fallback.** A man is drawn as the figure only once his figure is built in the worker (figure-ahead.js) and its shader has linked; until then he's the old body, so nobody blinks out. The shadows are still the old body's.
- **The kit (as built).** The figure's cloth takes the park's own kit atlas (diamond/kits.js), the same canvas the old body wore, so a club's kit, wordmark, number, surname, pinstripes and piping arrive unchanged and repaint when the club's kit does. gl/figure-hd.js `kitCloth` maps it, in its one call, before the folds and ink go on: the jersey round the body, its rows by Deadball's torso with the figure's joints laid on Deadball's, so the wordmark sits across the chest and the number in the middle of the back; each sleeve round its arm; the trousers round each leg, the knee three quarters down the cell; and the socks on the boot's shaft. Buttons are drawn down the placket. The jersey cut has no front of its own, and the street's wear and denim fading stay off the kit. The figure's belt is on, in the kit's belt colour. The umpires and the grounds crew keep their plain colours.
- **Still to do in phase 1:** the sleeve patch, the lettering standing off the cloth as tackle twill (the old body's `uTwill`), the undershirt's long sleeves, longer hair under the cap, the umpires' and coaches' own cuts and builds, the figure casting its own shadow, a budget per level in the gate, and the Player Lab.
- **What has to hold.** Every clip plays on the new body with the anim-smoke limits as they are: no foot slides on a plant, no contact error at the glove or the bat, no joint past its limit.
- **Cost.** About 28 people are on the field at once. The figure's `hd` level (about 22,000 triangles) is drawn only when a man stands taller than `PARK_FIGURES.hdPx` on the screen, and its `lite` level (about 9,000) otherwise.

## 2. Hands

- **Finger bones for everyone.** Each finger gets three bones and the thumb three, 15 a hand, skinned in the figure, so ROOM's people gain them too. The street crowd's bake leaves them out.
- **Hand shapes as a library.** A shape is a set of finger curls and spreads, keyed in clips like any other part of a pose.
  - Bat grips: standard, choked up, knob in the palm, pinky over the knob, and a loose grip for the waggle.
  - Pitch grips: four-seam, two-seam, curve, slider, circle change, splitter and knuckleball. The grip matches the pitch the server chose.
  - Glove hand, relaxed, pointing, fist, open in celebration, clapping, and the catcher's signs. Umpires get the punch-out fist and the flat palms of safe.
- **Contact, solved.** Fingers close round the handle until they touch it, so a choked-up grip and a bare-knuckled one both wrap the bat. The ball is held the same way. The gate measures fingertip gaps.
- **Close-ups that use them:** the grip turning in the glove during the set, the catcher's signs from behind the plate, and the batting-glove strap. The grip shot is a live tell: the director cuts to it now and then before a pitch, and the booth gets lines to call it ("that's the splitter grip"), sorted to agree with the pitch the way 3a sorts the lines for a ball in play.

## 3. The bat and the swing

- **Each man has his own bat.** Wood (pale ash, honey maple, dark birch), finish, knob, cupped or plain end, and tape or pine tar on the handle, all settled by his name.
- **Stance as data:** open or closed, deep crouch or tall, hands high or low, bat flat or straight up, waggle style, and weight back or even.
- **Swing as data:** the load, the stride (toe tap, leg kick or none), the attack angle, a one-handed or two-handed finish, and the helicopter finish. The swing clips blend by these numbers, and a procedural layer moves the hands and bat path onto them, so no two men swing alike.
- **Flips.** The styles are none (he drops it), a set-down, a toss, a spin flip, a launch end over end, and a staredown before he lets go. Each man's temperament (showman, stoic, hothead, old pro) decides when he flips: always on a home run, on a big hit or a walk if he's a showman, never if he's a stoic. Flight comes from the hands' last frames, as loose-bat.js does now, with the spin the style gives.

## 4. Pitchers

- **A delivery is a set of numbers,** settled by the pitcher's name, or by his row for a First Gen man: arm angle (submarine to over the top), release height, extension, which side of the rubber, stride length and line (crossfire or closed), tempo, leg kick (slide step, high kick, double kick, turn-back), glove action, head movement, and the finish (falls off to the side, or finishes square).
- **On screen.** The three slot clips blend by arm angle, and a fourth clip adds the submarine pitcher. At the release event the hand is moved to the computed release point, and the pitch's flight starts there.
- **In the sim.** The numbers move to a shared module that the server's `baseball.js` imports alongside `traitOf`. Extension adds perceived speed, an odd or low slot adds deception, and sidearm sharpens the platoon split. Each effect is small, and the [simulation grading](../reports/simulation-grading.html) is run before and after to check league averages hold.
- **Between pitches:** the rosin bag, a cap tug, a glove to the face, a walk round the mound, and how long he stares in for the sign. These come from the same parts library the batters use.

## 5. Personality

One record per man, settled by his name, pure, imported by server and client:

- **Routine:** which parts he does, in what order, how many practice swings, and how often he steps out. The routine changes with the count, so he steps out after a strike he didn't like.
- **Kit:** socks high or trousers to the shoe, sleeve length, cap set straight or tilted, undershirt colour, a shirt tail out on a veteran.
- **Gear:** batting gloves or bare hands, wristbands, elbow and shin guards, eye black, sunglasses, a chain.
- **Chewing:** gum (with the odd bubble on the bench), sunflower seeds, tobacco, or nothing. The jaw keeps moving through his idles.
- **Face:** expression beats at the moments that matter: effort at the release, a grimace on a swing and miss, a roar on a home run, a glare at the umpire, a smirk on a flip. These play through the expressions system's faces.
- **Hair and beard:** hair showing under the cap and longer hair out the back, the helmet coming off with his hair under it, beards and stubble from the sculpted head.

Routine parts are short clips that start and end in a pose his stance can join. The composer strings them together and the clip player crossfades them, as it does now. The First Gen men and a handful of named stars get signature routines keyed by hand over the composed one.

## 6. Uniforms

- **Shells over the body:** the undershirt, the jersey (button placket, piping, sleeve cut), the trousers (bloused at the knee or long), belt and loops, stirrups and sanitary socks, and cleats.
- **Lettering with thickness:** numbers, names and the wordmark as tackle twill, raised, with a stitched edge in the paint. The club's kit and crest come through [club-crest.js](../../client/game/js/panels/club-crest.js) as they do now.
- **Cloth:** a fabric normal map (knit), folds driven by the joints (inside the elbow, behind the knee, at the waist on a twist), and the jersey's tail swaying.
- **Wear over a game:** dirt already collects. It gains grass stains and slide marks placed where his body touched the ground, sweat darkening the collar and back late in the game, and a dusty face after a head-first slide.

## 7. The First Generation, rebuilt

Each order gets its own way of being changed, its own materials and its own effects. An Ascendant's parts map to `content/augments/` and a Wildblood's to `content/mutations/` where one fits, so what the TV shows agrees with what the game says those things are. The Null's limbs aren't augments rows ([deadwater.md](deadwater.md)), and the Long Watch have nothing added. The man-by-man designs are in [deadball-gen1-sheets.md](deadball-gen1-sheets.md).

| Order | How it sits on him | Materials | Effects |
|---|---|---|---|
| Ascendant | Seamless and surgical. Plates lie flush with the skin, seams are hairline, and the skin weave shows as a faint sheen beneath the skin. Light shows only at the seams. | Ceramic, frosted glass, a cool glow through the seams | Seams pulse with his effort, a soft bloom, and a clean servo whir on the swing |
| Null | Analog and open. Cable-and-spring limbs with cover plates that open, Bowden cables that sag and swing, solder-stopped sockets where city chrome was cut out, and a servicing card tied to every limb. Nothing carries a radio. | Bare and painted steel, brass, leather straps, grease | Nothing lights. Springs twang, rams chuff, ratchets click, and the broadcast picture may break up on them (an open question in the sheets) |
| Wildblood | Grown. The skeleton itself changes: digitigrade legs with their own run, real tails that swing and balance, a second pair of arms on their own bones, horns, carapace and thorns, all through the figure's grown bones and `MUTATION_LOOK`. | Hide, chitin, keratin, mottled and veined skin | Glowing spots that flare when he sprints, breath fog, dust off the hind legs, ears that flick |
| Long Watch | Ritual and minimal. Scars, wraps, beads, ochre and braids, almost no hardware. What marks them is how they move: stillness, breathing, long routines. | Cloth, leather, bone, pigment | Very little: beads swinging and a chalk dust off the wraps. The signature routines do the work. |

Some of these men need clips of their own: Hopscotch's and Long Jump's digitigrade run, the Horn's lumbering trot, and Brute Force's swing with a gun arm. Four Arms needs the most: a four-handed grip and swing, a lower hand barehanding a ball past the glove, a dive braced on the lower pair, and the lower pair's own idles, claps and points.

### The renames

The league is all men, so these twelve take new names. The nicknames stay except the Gilt Lady's. None of the new given names is used by an NPC or in a broadcast, and no surname repeats inside the First Generation (Sela Fen's would have sat beside Ottilie Fenn's).

| Order | Was | Now | Nickname |
|---|---|---|---|
| Ascendant | Solace Wren | Cassian Wren | Halo |
| Ascendant | Petra Lisle | Aldous Lisle | Second Skin |
| Ascendant | Ilse Marrow | Anselm Marrow | The Gilt Edge (was Gilt Lady) |
| Ascendant | Yuna Castellane | Julian Castellane | The Ascension |
| Long Watch | Mara Coil | Tamas Coil | Nine Breaths |
| Long Watch | Sela Fen | Simeon Holt | The Patient |
| Wildblood | Vesna Ruk | Skell Ruk | Long Jump |
| Wildblood | Ottilie Fenn | Gorse Fenn | Four Arms |
| Wildblood | Kessa Thorn | Kester Thorn | Briar |
| Null | Juno Blank | Jonah Blank | The Glitch |
| Null | Nyx Ohara | Lucan Ohara | Null Pointer |
| Null | Ada Vox | Bastian Vox | Overwrite |

Before the rename lands, check every place a player's name is stored (season stats, saved rosters, the booth's scripts, trading cards), because a man's look and traits come off his name.

## Phases

1. **The athlete body.** The figure's `athlete` build and baseball cut, the retargeted clips, and the Player Lab. Nothing looks worse than now, and the anim gates pass unchanged.
2. **Hands and the bat.** Finger bones, the hand-shape library, solved contact, each man's own bat and grips.
3. **Pitchers.** The delivery as data, the blended slots and the submarine clip, release by IK, and the sim change graded.
4. **Personality.** The persona record, the routine composer, stances and swings, flips, kit and gear, chewing, and faces.
5. **The First Generation.** The four orders' builds, materials, effects and own clips, and the renames.
6. **Finish.** Cloth folds, stains and sweat, and the close-up and replay cameras that show the work off.

Each phase runs behind a switch until it beats the one before it on the same shots.

Umpires, coaches and the grounds crew move to the new body in phase 1 with the players: the umpires with their chest protectors, masks and call styles, the coaches in windbreakers flashing signs with real fingers, the crew in work clothes. The athlete build keeps hockey in mind (a skater's crouch, pads under the sweater) so the CPhL can take it up later, but that's its own project.

## Open questions

- **Signature stars:** besides the 32 First Gen men, who gets a hand-keyed routine?
- **The four orders' designs, man by man:** each of the 32 needs a sheet (silhouette, what's changed, materials, the flip, the routine) before phase 5 starts.
