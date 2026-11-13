# The bestiary's art direction

**Status: concept, partly built.** The beasts' light ([gl/beast-light.js](../../client/game/js/panels/gl/beast-light.js)), the beast kit's palettes, glows and jointed legs ([gl/beast-kit.js](../../client/game/js/panels/gl/beast-kit.js)) and every enemy's recipe ([bestiary-recipes.js](../../tools/modelshop/bestiary-recipes.js)) are built and shown on the Modelshop's Bestiary (`/bestiary.html`). Only the gutter hound reaches the Room Stage ([gl/beast-looks.js](../../client/game/js/panels/gl/beast-looks.js)). The recipes become content before the rest does.

## Why

The first pass drew every enemy at the close-up figure's level of detail, and the ideas held up, but the execution looked amateur. Every palette was a muddy brown or grey, every shadow was the base colour darkened, every part of a body had the same weight, and a glowing eye was a flat dot. Meeting an enemy in a room has to be something you remember, and that comes from colour and light more than from triangles.

Anime is the model for creature design, colour and light. It isn't the model for faces: people stay Borderlands, as [hd-figure.md](hd-figure.md) has them.

## The rules

Each rule is something the code does, with the source it comes from.

1. **A shadow is a colour, not a darker base.** Michiyo Yasuda moved Ghibli from grey shadows to "deep or vivid" ones [1]. Yukiko Kakita chose a purple shadow because a pastel palette "blends too easily into the background" [2]. Every vertex carries its own shadow colour, and a family's rule pulls each base toward its shadow hue (`shadeTo`), about 55% darker and toward violet or the complement [3][4].
2. **Keep light in the shadows.** The *A Silent Voice* team kept "as much light as possible, even in the shadows" [5]. The shadow tone is lit at half the key, so it's a value, not a hole.
3. **A third tone at the turn.** A thin, more saturated core band sits just past the terminator, as Honkai's stacked ramps do [6].
4. **Two rims.** A sliver on the lit side in the key light's colour (Roystan's toon rim, threshold 0.716 [7]), and the family's back rim, thin, round the whole silhouette, so a body separates from a dark room. Rim colour follows the feeling, not physics [8].
5. **One accent per enemy, and it carries a state.** The Evangelion Angels' red core is the template: one feature, constant across very different silhouettes [9]. The Ohmu's eyes turn from blue to red when they're angry [10]. Saturation and emission go on the focal part; the rest stays two tones in a rough 70/30 split of rest to detail [11]. The field cull's eyes switch from blue to red; the cable eel's studs carry a pulse; the redline horror's core beats.
6. **A glow has a white-hot core and a halo whose hue shifts outward.** In cel compositing, light was shot through gels in passes, dense at the source and falling off fast, never an even Gaussian. *Akira*'s lights shift to cyan away from a white centre [12]. The kit's `glow` draws an unlit core that whitens where it faces you, adds a soft halo shell (an exponential falloff, cyan-shifted for a cool source and red-orange for a hot one), and puts a light on the body round it, so a furnace lights its own chest.
7. **Materials by what they do to light.** Light comes through a membrane, a slime or a leech's lip as a saturated band at the edge (wrap lighting, GPU Gems ch. 16 [13]). Chitin, oil and glass carry a thin film whose hue steps with the angle and goes blue at grazing angles, as a jewel beetle's does [14][15]. Embers follow the blackbody ramp from dark red to orange to yellow-white [16]. Deep-sea light is blue-green, 470 to 490 nm, and a dragonfish's far-red lure barely shows [17].
8. **Each family has a shape grammar.** In *Promare*, the Burnish are triangles and Promepolis is squares [18]. Here the Thornwarren is spines and triangles, the police and Halcyon are boxes and symmetry, the Under is soft masses, and the Architect's own are pure geometry. Ramiel is an octahedron, which is why it reads as a different kind of enemy [9].
9. **A human part in the wrong place.** Sachiel's bird-skull mask and Sahaquiel's hand-like wings [19], and Nihei's gauna, which are creepy because of the human elements in them [20]. The Midden has a pale face half sunk in the middle of it; the tar horror carries up a hand and a skull.
10. **A plausible animal first, then one break.** Neville Page gives every creature a reason to exist [21], and Monster Hunter drops a monster whose habitat and diet can't be explained [22]. A spider is a cephalothorax and an abdomen on a pedicel with eight segmented legs; a roach is flat under a pale-rimmed pronotum with spines down its tibiae; a harvestman is a pea on stilts with an eye turret. Each mutant breaks one proportion and keeps the rest human.
11. **Memorable beats cool.** Sugimori takes the edge off designs that are too cool [23]. The hound keeps its torn ear, and the maintenance drone tilts its head like a curious Tachikoma [24].
12. **Motion on twos.** Smooth interpolation reads as 3D; cel animation holds a pose for two frames [25][26]. The Bestiary moves its beasts at twelve poses a second.

## The families

Each enemy belongs to one register (`FAMILY` in the recipes). The register sets where its shadows go, its rim, its accent and how it's lit on the Bestiary's stage: a tinted key and a coloured back light.

| Family | Shadow / rim / accent | References | Members |
|---|---|---|---|
| `wet`: gutter vermin | `#2e3a52` / `#b8f0d8` / `#2bf5c8` | Nausicaä's swarms, *Mushishi*'s translucency, bioluminescence | sewer roach, printer roach, rats, snake, lamprey, leech, slime, choke swarm, gulper, bat, grease ghoul |
| `under`: the deep Under | `#0c2a2c` / `#5af0c8` / `#7dffb4` | the Sea of Corruption | tunnel horror, pipe stalker, lime walker, rebar shambler, deadhead |
| `midden`: fused masses | `#170f24` / `#e0507a` / `#ff3b1f` | the tatarigami's writhing black flesh [27] | the Midden, the tar horror |
| `pale`: the pale things | `#8f8ab8` / `#ffffff` / `#8fe3ff` | the Forest Spirit, No-Face's mask on a void [28] | the Sunless, the tunnel crawler, the blind crawler, the glass tick, the bay leviathan |
| `burn`: slag and cinder | `#120d14` / `#ff6a1a` / `#ff890e` | blackbody light, red-orange halation [12][16] | slag wight, slag wretch, cinder saint, ash crawler, ashfall drifter, slag rat |
| `halcyon` | `#8a96b4` / `#ffffff` / `#4fd1c5` | Ramiel's perfect geometry; Promare's squares | the adjuster (its pin is its only saturated pixel), the supervisor |
| `police`: SPECTER-PD | `#3a4870` / `#9fd4ff` / `#2e7bff` | Tachikoma [24]; Patlabor's police equipment | officer, trooper, heavy enforcer, patrol drone |
| `angel`: the Architect's own | `#0a0a18` / `#e8eeff` / `#f4f8ff` | the Angels | the Arbiter (one value and a white slit), the scout drone (black glass, gold in the seams) |
| `municipal`: tired machines | `#6a3424` / `#ffc070` / `#ffa020` | | maintenance drone, sweeper |
| `bleed`: the Bleed's flesh | `#5a2a5e` / `#ffd9b0` / `#40c8ff` | Titans' wrong proportions [29], Kakita's purple shadow | the mutants, the tinnitus saint, the redline horror |
| `thorn`: the Thornwarren | `#2d2a4a` / `#ffe6a8` / `#ff3b30` | the boar gods, the Ohmu's state eyes | gate warden, field cull, road harrow, bramble whistler, bracken hulk |
| `chitin`: great arthropods | `#1e2440` / `#ffb070` / `#ff2d55` | jewel beetles, the Ohmu | ferric strider (tempered-steel film), Sump Widow (oil-slick abdomen, crimson hourglass, red eye cluster), rust bull |
| `deep`: the deep water | `#0a1220` / `#6fe8ff` / `#2bf5c8` | dragonfish photophores and lures [17] | cable eel, harbour lurker, gill mutant |
| `street`: the city's animals at night | `#2c2650` / `#ff6ab8` / `#ff8a20` | *Edgerunners*' neon smog [30] | gutter hound, feral dog, wire jackal, gutter cat |

The people's own clothes and skin are lit by the close-up figure's shader, which has none of this. Only their gear (armour, masks, lights) takes the family's palette.

## Legs

A spider's or an insect's leg is `jointedLeg`: coxa, trochanter, femur up to the knee, a short patella, the tibia, the metatarsus and the tarsus, ending in two claws. Each segment is its own tapering tube, swollen where the muscle is, with a collar at its far end in the band colour and a pale membrane at the joint, so the leg reads as segments from across a room. Rows of spines rake toward the tip along the femur, tibia and metatarsus, setae can be added, and `wrong` puts a backward kink in the tibia. An insect's abdomen can be laid as overlapping tergites (`plates`), each lapping the one behind it.

## Faces

A cat or a dog gets its own face: `head: { face: 'cat' }` or `'dog'` makes `mammalHead` draw `fineHead` instead of the generic skull, which the rats, the bull and the bat keep. The cat is drawn after a comic tomcat. Its face is round: a ball of a cranium, full cheeks, and the muzzle a mass of its own under the nose, never a snout. Big ears sit on the upper corners. The almond eyes are one eye's width apart, outer corners up, the upper lid brought down toward the nose (`scowl`). A short bridge runs down to a broad pink nose just under the eyes, with comma nostrils. White whisker pads carry rows of dots and soft drooping whiskers. Black-edged lips curve from the split under the nose back to corners well under the cheek, over a small chin.

The dog has a boxy muzzle under a stop. Its skull carries its build: cheekbones, temple muscles, a ridge over each eye and a groove down the forehead. Its eyes sit at the stop and show next to no white. Tan brow pads say what it feels: held up on a wary dog, pulled down on a snarling one, whose forehead knots into frown lines. It has a leather nose with comma nostrils, black-edged lips that hide all but the canines and incisors, and creases across the muzzle when it snarls (gape 0.18 and over). `blaze` paints a white stripe from the crown down between the eyes.

- An eye is `almondEye`: the lid skin painted over all of the ball but the opening, and the pupil laid on as its own skin, so a slit stays sharp. Its lids are folds of skin over the ball, crescents pointed at both corners and standing off it at the free edge. The upper lid is the deeper, with a crease over it. The margins are black, the upper one running on in a short wing past the outer corner. The third eyelid shows in the inner corner.
- A whisker, a hair, a marking or a catchlight goes through `inkless`. The ink is a fixed number of pixels wide, so anything thinner comes out as a black bar. A piece made in `inkless` has its normals shrunk below the ink pass's cut-off, and the lit pass normalises them again.
- Paint a marking's edge as a blend, never a step: the vertex colour saws a hard edge across the triangles. A marking that needs a crisp edge is a stroke laid on the skin.

## Fur

A furred animal is drawn as shell fur, a strand at a time. `quadruped`'s `fur: { body, head, legs, tail }` (model units) sets how long each part's fur is as the part is made. Every triangle carries its length (`M.F`, from `M.furLen`; `withFur` sets it for one piece). Once the animal is built and scaled, `furShells` draws each furred triangle again in layers, each further out along its normals. The beast shader (`gl/beast-light.js`) keeps only the strands that reach each layer. A strand stands at a random point near its root, and a point of the coat belongs to the nearest one, measured along the skin, so the coat has no grid lines and every strand is round. Short fur is finer and barely shaded, so a face reads as velvet. The gutter cat is the only furred animal so far.

A rough coat goes over the soft one: `furCoat` lays clumps of fur over a part, from a recipe's `extra`. Each is turned a little its own way, a third longer or shorter than its neighbours and a shade lighter or darker, so the coat reads as shaggy clumps, never as scales. They're outlined finer than the body: their normals are 0.45 long, and the ink (`gl/ink.js`) draws a normal shorter than 1 with a line that much finer. Keep them to where the animal has them, and lying the way the coat runs. Spread over the whole back they read as feathers; standing up in a row, as thorns. The cat's mane starts at the crown, runs down its neck and chest and thins out over its shoulders. It also has britches over its hind legs and a fringe under its belly; the soft fur does the rest.

- Only matte surfaces take fur, and nothing near the floor. Eyes, ears, tufts and uninked pieces never do.
- A layer carries what the shader needs in what a vertex already has: its material is `FUR` (50) plus its height in fifteenths, and its normal's length is the fur's length in metres.
- Materials 50 to 65 are dropped by the ink (`gl/ink.js`) and by the room's depth prepass (`gl/room.js`). Inked, a layer's unpushed copy would show black through its holes; in the prepass, its outer layer would hide the coat and the body under it.
- `budget` caps the triangles a coat adds. Over it, short fur goes down to two layers first, and the long fur shares what's left. The legs gate holds a whole animal to 90,000 triangles.
- The strand points are in room space, so a coat on an animal that walks would crawl over it. The bestiary's cat stands still; a walking furred animal needs its points in model space first.

## What not to do

- Grey or black shadows, and mid-values everywhere: the whole first pass [1].
- Saturation and detail spread evenly. Small noisy detail reads as grime, not form [11].
- A glow that's an even blur [12], or diffusion used to cover a weak design [31].
- One enemy PBR-shaded and the next cel-shaded [32].
- A design with no flaw [23].

## What's left

- The recipes are a Modelshop file. Each becomes content (an enemy's `flags.figure` for a person, a `flags.body` naming a kit build for anything else) before it ships; the gutter hound already reads its colours from its fauna row.
- The people's skin doesn't take a family's shadow or rim, or the light off their own glows. That needs the close-up figure's shader to read a palette.
- Outline weight is the house line everywhere. Guilty Gear varies it by mass and closes it in valleys [33]; the kit could carry a per-vertex weight.
- A per-room colour filter (night bluer and darker, as Arisa Komatsu builds night palettes [34]) and impact frames are design.

## Sources

1. Animation Obsessive, "The artist who colored Ghibli": https://animationobsessive.substack.com/p/the-artist-who-colored-ghibli
2. Newtype interview with Yukiko Kakita: https://furinkan.com/features/interviews/newtype202411e.html
3. Hue-shifted shading: https://ziva.sh/tools/pixel-art-palette-generator, https://pixnote.net/en/learn/shading
4. Gurney, complementary shadows: https://gurneyjourney.blogspot.com/2014/09/complementary-shadows.html
5. *A Silent Voice* staff roundtable: https://blog.sakugabooru.com/2020/04/30/koe-no-katachi-a-silent-voice-staff-roundtable-aesthetics-team/
6. Honkai Impact 3rd, Unite Tokyo 2018: https://docswell.com/s/UnityJapan/KWLQP5-unite-tokyo-20183rd
7. Roystan, toon shader: https://roystan.net/articles/toon-shader/
8. Imaishi AMA: https://www.bubbleblabber.com/2022/12/reddit-ama-recap-hiroyuki-imaishi/
9. The Angels: https://en.wikipedia.org/wiki/Angels_(Neon_Genesis_Evangelion)
10. The Ohmu: https://ghibli.fandom.com/wiki/Ohmu
11. Design principles: https://mayabeginner.readthedocs.io/en/latest/Design/L3_DesignPrinicplesPrimer.html
12. Animation Obsessive, "Dangerous light": https://animationobsessive.substack.com/p/dangerous-light
13. GPU Gems ch. 16: https://developer.nvidia.com/gpugems/gpugems/part-iii-materials/chapter-16-real-time-approximations-subsurface-scattering
14. Belcour and Barla, iridescence: https://blog.unity.com/technology/a-practical-extension-to-microfacet-theory-for-the-modeling-of-varying-iridescence
15. Stavenga et al., jewel beetles: https://pmc.ncbi.nlm.nih.gov/articles/PMC3049007
16. Helland, colour temperature to RGB: https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
17. Dragonfish bioluminescence: https://biolum.eemb.ucsb.edu/organism/dragon.html
18. Imaishi and Nakashima on *Promare*: https://www.animenewsnetwork.com/interview/2019-12-20/promare-director-hiroyuki-imaishi-and-screenwriter-kazuki-nakashima/.154605
19. Bogleech on the Angels: https://bogleech.com/eva
20. Tsutomu Nihei interview: https://www.barnesandnoble.com/blog/tsutomu-nihei-on-blame-knights-of-sidonia-and-viewing-tokyo-like-an-outsider
21. Neville Page on the Cloverfield monster: https://gizmodo.com/io9-talks-to-cloverfield-monster-designer-neville-page-357856
22. Monster Hunter Wilds monsters: https://www.siliconera.com/interview-preparing-monster-hunter-wilds-monsters-and-environments
23. Sugimori on memorable designs: https://www.nintendolife.com/news/2018/07/ken_sugimori_wants_pokemon_designs_to_be_as_memorable_as_possible
24. Tachikoma: https://en.wikipedia.org/wiki/Tachikoma
25. Demon Slayer's visual grammar: https://jbsiraudin.github.io/blog/demon-slayer-visual-grammar
26. Arc System Works' limited animation: https://www.gamestar.de/artikel/dragon-ball-fighterz,3325366.html
27. *Princess Mononoke*: https://en.wikipedia.org/wiki/Princess_Mononoke, https://thespool.net/features/princess-mononoke/
28. No-Face: https://ghibli.fandom.com/wiki/No-Face
29. Isayama's inspiration: https://www.animenewsnetwork.com/interest/2018-05-07/hajime-isayama-shares-his-inspiration-for-attack-on-titan/.131234
30. *Edgerunners*: https://awn.com/animationworld/cyberpunk-edgerunners-vibrant-ode-retro-anime
31. Kentaro Waki interview: https://www.animenewsnetwork.com/interview/2019-01-09/sword-art-online-alicization-director-of-photography-kentaro-waki/.140449
32. *Promare*'s flat colour: https://anigamers.com/interviews/promare-creating-kaleidoscopic-visual-style-trigger-hiroyuki-imaishi-shigeto-koyama-hiromi-wakabayashi/
33. Guilty Gear line control: https://www.docswell.com/s/ASW_Academy/5LVY67-GG-Toonline-Eng
34. Arisa Komatsu interview: https://www.animenewsnetwork.com/interview/2024-11-15/the-complicated-process-of-color-design-in-anime-an-with-nokotan-arisa-komatsu/.216975
