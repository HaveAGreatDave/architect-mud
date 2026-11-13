# Pets

**Status: phase 1 built (the model, in the Modelshop); phase 2 started (the `pets` table, Scrappy as an NPC in Cyd's flat, drawn as the cat in ROOM); the rest is design.** The statue it started from is stowed (see [Scrappy](#scrappy)).

A pet is an animal that lives in your home. It's in the text world as an NPC you can see, hear and talk to, and in ROOM as an animal walking about your flat. For now it never leaves the home it was given to. You feed it, pet it, play with it, brush it and clean up after it, and it does a lot of things on its own while you watch.

The first pet is a cat, and the first cat is Scrappy. Cats will be customizable, but Scrappy gets everything first: the model, the behaviours, eating, sleeping, petting and the sounds are all built and tuned on him, and only then opened up to other cats. The aim is the best cat in any game: a cat that does what cats actually do, for the reasons cats actually do it.

## Scrappy

Scrappy was a marble statue in Solenne 30-B (`furn_solenne_b_fountain`, the `catstatue` form in `gl/room-decor.js`, carved by `gl/cat-statue.js`). The statue is stowed: the furniture file is out of `content/` and kept beside this doc as `pets/furn_solenne_b_fountain.json`, and the carving code stays where it is. Put the file back in `content/furniture/` to put him back.

The statue is where the live cat starts. It was one signed distance field (ellipsoids and tapered limbs joined by smooth unions, the details cut in) meshed once. The cat kit (`client/game/js/panels/gl/cat-kit.js`) is the same field hung on a skeleton: every piece belongs to a bone and is written where it sits on a cat standing square, and a pose moves the bones, so a folded hip is carved folded and blends into the flank the way the stone did. The head, the ears, the eyes, the lids and the paws are the statue's own shapes. Each pose is baked once (about 1.5 s at 2.7 mm); what moves while a pose is held (breathing, the head looking about, each ear on its own, the tail, a slow blink) is that bake skinned to the bones, and the eyes, lids and whiskers are built every frame on the head.

He's off two photos of him: a fat, fluffy tom with a black saddle over his back and sides from behind the shoulders to the tail, a white chest, belly and front legs, black hind legs in white socks, and a black patch on the front of his left shoulder. On his face: a thin black cap joining the bases of his ears, a patch round the outer side of his left eye that runs up into a black left ear (the right ear is white, pink inside), a handlebar moustache, bigger on his right, a spot on his chin, a pink nose and pale round eyes. In one photo he's sitting up on his bum like a person, front paws in the air, which goes on the list of idles.

The Cattery (`/cattery.html` on the Modelshop, recipes in `tools/modelshop/cattery-recipes.js`) shows him and three other cats in four poses (stand, sit, loaf and curl), idling, with sliders for the build, the coat and the eyes and a random-cat button. `scripts/cats/cat-smoke.mjs` is the gate.

The face is carved on a grid twice as fine as the body's (`faceH`), inside a ball round the head, with the seam in the ruff; that's most of the 240k triangles. It follows how a cat's face is built: the eyes on the head's midline, about an eye's width apart, slanting up and out under full upper lids with a dark rim, and a dark line at the inner corner; a small inverted-triangle nose with a nostril either side at the crossing of the eye line and the middle of the face; puffy whisker pads as their own volume, with four rows of roots and twelve whiskers on each, two over each eye and two on the chin; the head widest at the cheeks under the eyes. The ear is a cone of cartilage opened at the front, its inner edge straight and its outer edge bowed, the cup deepest where the canal turns down into the head, a fold across it, rolled rims, Henry's pocket in the outer edge at the root, and pale furnishings fanning out of it on the ear's own bone. A patch that needs a designed edge (his left-eye patch) is a polygon traced off the photos in the face's front view (a `poly` mark) rather than an ellipse.

The face is lit through a rounder normal than the one it's carved with (`faceSoft` on the bake, 0.6 by default): the field's normal bent toward the way out from a point set back in the skull, fading out toward the ruff, so the comic terminator crosses the head as one ball instead of cutting a band along the cheeks and whisker pads; the creases still read from the shading baked into the coat. A pose is carved in a worker (`bakeCatOff` in `gl/cat-bake.js`, the worker `gl/cat-bake-worker.js`), which hands back the same bake `bakeCat` would, so a room or the Cattery keeps drawing while it carves.

Still rough in phase 1: the rounder face light hasn't been seen on a real GPU yet; the curl reads as a sleeping cat from above but has no weight where it meets the floor; the fur shells have only been seen under software GL (the Browser pane had no WebGL2), so they need a look on a real GPU; there's no jaw, so no meow or yawn yet; and moving between poses is phase 3.

The model bar, in the comic look ([comic-ink.md](comic-ink.md)):

- A cat's body, not a small dog's: a long, loose back that bends a lot, shoulder blades that ride up when he stalks, a primordial pouch that swings when he trots, hind legs longer than the front.
- A head that moves on its own: ears that each turn and flatten separately (about 30 muscles each), whiskers that fan forward when he's curious and lie back when he's scared, pupils from slits to full circles with the light and his mood, a third eyelid on a slow blink.
- A tail with its own spine of about 20 joints, driven by mood, not by the gait.
- Fur as shells or cards along the outline, so a puffed tail and raised hackles actually change his outline.

### A cat is a set of numbers

Scrappy is built as one set of parameters from the start, so a second cat is a second set and not a second model (`CAT` and `catLook` in the cat kit): the build (`length`, `neckLen`, `belly`, `pouch`, `chest`, `hips`, `neck`, `legLen`, `legW`, `head`, `cheeks`, `ears`, `muzzle`, `tailLen`, `tailW`), the coat (a base colour, white spotting from none to van, tabby stripes, and marks laid over it on the body or the head), the eyes (iris, rim, pupil, and `size`, `open`, `sunk` and `droop`, which shape the eye, its socket and how far the upper lid rests down) and the fur lengths. Personality joins it in phase 2. Nothing in the model, the clips or the sim may mention Scrappy by name; he's a row of data like any other cat will be. Customization itself (a picker, more patterns) waits until he's finished.

## The cat sim

Everything he does comes from a few numbers, as Cathode's behaviour comes from `moodToward()` ([systems-strays.md](../systems-strays.md)).

### Needs

Each need is a level and a timestamp, worked out when it's read, never on a tick.

| Need | Rises with | Met by |
|---|---|---|
| hunger | time; two or three small meals a day | `feed`, a bowl that's been filled |
| thirst | time, faster on dry food | a water bowl; he'd rather drink from a tap or a glass |
| tiredness | being awake; a cat sleeps 12 to 16 hours a day | sleeping in his spot, which moves with the sun |
| boredom | time indoors | `play`, a toy, a window with birds |
| litter | meals | a clean tray; a dirty one and he goes elsewhere |
| grooming | time, mess | grooming himself; `brush` for the bits he can't reach |

### Bond and personality

Bond is how much he trusts you, per person, and it moves slowly. Personality is fixed per cat, on the five axes of the Feline Five (Litchfield et al., 2017): skittish, outgoing, dominant, impulsive and friendly. Scrappy is outgoing, a bit dominant, not skittish. Two cats with the same needs and the same bond do different things.

### What he does on his own

Each is an idle clip in ROOM and a line in the text world. The clip is picked by the server from the needs, the bond, the time of day and the room; the client only plays it.

- Sleeping: curled tight when cold, belly up when warm and safe, loafed with paws tucked, in a sunbeam that moves through the day.
- Grooming: paw licked then wiped over the ear, a hind leg up, a sudden bite at an itch.
- Greeting: tail straight up with a hooked tip, a trot over, a head bunt or a rub along your shins.
- Kneading on a soft thing, purring, eyes half shut.
- The slow blink, which you can return (`blink at`), and which raises bond.
- Zoomies at dusk and dawn, when cats are most active, with a skid on the turn.
- Watching the window, with the chatter at birds. The birds are the real birds outside ([systems-fauna.md](../systems-fauna.md)), in the window view ROOM already paints.
- Stalking a toy or a moth: low, bum wiggle, pounce.
- Knocking a small thing off a table while looking at you.
- Sitting in any box or bag left on the floor, and on whatever you're reading.
- Hiding under the bed when there are strangers, loud noise or he's ill.
- Bringing you a gift.
- Yawning, stretching (front down, then back legs), the flehmen face at a smell.

### Petting

He decides how long petting stays nice. The head, cheeks and chin are safe; the back is fine for a while; the belly is a trap. As petting goes on he shows it's enough, in order: a twitching tail tip, skin rippling on his back, ears turned sideways, a look, then a bite or a swipe. A player who stops at the first sign raises bond; one who ignores them loses it. This is the same refusal ladder Cathode has, run in seconds instead of visits.

### Talking

Cats meow mostly at people, not at each other. He meows to be fed, to be let somewhere, to say hello, and each sounds different. He also trills, purrs, chirps at birds, hisses and growls. These are SIREN cues, not samples, built the way [sfx-craft.md](../reference/sfx-craft.md) says.

### Neglect

He doesn't die of neglect. A hungry cat yells, then sulks, then hides, and the bond drops. A dirty tray means a mess somewhere in the flat ([systems-cleaning.md](../systems-cleaning.md)). After long enough with nobody caring for him, he's gone: rehomed, with a note.

## How it's built

- **Plugin `plugins/pets/`.** Verbs: `feed`, `pet`, `play`, `brush`, `call`, `name`, `blink`, `pick up`, `clean tray`. It owns the pet and nothing else's verbs.
- **State.** A `pets` table: id, species, name, home zone (null for a street cat), the body parameters, personality, and a JSONB of needs and timestamps. A `pet_carers` table: pet, player, bond, and when they last met. Loaded into RAM with the home; writes coalesced and flushed. No column on `players` or `npcs`.
- **The text world.** The pet shows in the room as an NPC. Its ambient lines come from the same state as the clip, so the text and the picture agree.
- **ROOM.** A `pet` actor in the Room Stage. The server sends a beat (what he's doing, where, from when); the client plays the clip and moves him between spots. Anything that's just a pose (a tail flick, an ear turn) is worked out on the client from the beat and the clock, as birds are, so it costs no messages.
- **The Modelshop.** The cat is a subject there with a pose lab, so every clip can be looked at without a server.

## Phases

Phases 1 to 4 are all Scrappy. Phases 5 and 6 open it up.

1. ✅ The model: Scrappy carved from the statue's field on a skeleton, from his parameter set, in the Modelshop with stand, sit, loaf and curl, idling.
2. The plugin: the table, the needs, `feed`/`pet`/`name`, Scrappy in the text world in Cyd's home. Built so far: `plugins/pets`, the `pets` table (`content/pets/`), Scrappy as `npc_pet_scrappy` in Solenne 30-B, and the Room Stage drawing him as the cat (`roomstage.npcBeast`, `gl/room-beasts.js`), settling in a new spot and pose every four minutes and holding still there (the idle waits for skinning on the GPU: on the CPU it costs 60 to 130 ms a build). The needs and the verbs past the engine's own `pet` are still to do.
3. ROOM: the actor, walking between spots, eating from his bowl, sleeping and grooming, petting with the ladder.
4. The rest of the clips, the sounds, play and toys, the window and the birds.
5. Customizable cats: coats, builds and personalities from the same parameters, and a picker.
6. Street cats and the shelter: cats with no home on the streets, a shelter to adopt from, and taking a street cat in.

## Decided

- **Scrappy is Cyd's.** He lives in Cyd's home, and that's where he's built and tested.
- **Everything is a foundation.** Every piece built for Scrappy (the model, the clips, the needs, the verbs, the table) has to work for any player with any cat. Scrappy is the first row, never a special case. A check that only passes because the cat is Scrappy, or the owner is Cyd, is a bug.
- **Where cats come from.** Cats live on the streets, and there's a cat shelter. A player can take in a street cat or adopt one from the shelter. Street cats use the same model, clips and personality as pets; a pet is a cat with a home and an owner, and a street cat is one without. Cathode ([systems-strays.md](../systems-strays.md)) should end up drawn and animated the same way.
- **A cat has carers, not one owner.** Anyone who lives in the cat's home can feed, pet and care for it, and the cat keeps a separate bond with each of them. So the table has one row per cat and one row per carer, never an owner column on the cat that a second person has to be squeezed into.
- **A cat can change hands.** A pet can be given to another player or let go onto the street, and a street cat can be taken in. Going from pet to street cat and back only changes the cat's home and carers; its body, personality and memory of each person go with it.
