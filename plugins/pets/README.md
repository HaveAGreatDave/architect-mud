# pets

**Status: phase 2 started.** The table, the pet as an NPC, the cat in ROOM moving all day and up on the furniture, his day said in the text world, the greeting at the door, the petting ladder by spot, his bowls and `refill` are built. Needs, carers and the other pet verbs are design. The full design is [docs/proposals/pets.md](../../docs/proposals/pets.md).

A pet is two rows:

- **Its NPC** (`content/npcs/`, `flags.pet` naming its pet row, `flags.animal` true). This is the animal in the text world. The engine lists it in the room, `look` and `pet` work on it, and boot puts it in its `home_zone`. Give it `wanders: 0` so it stays home.
- **Its row in `pets`** (`content/pets/`): `npc_id`, `species`, `look` (the cat kit's numbers, `client/game/js/panels/gl/cat-kit.js` `catLook`) and `personality` (the Feline Five).

## What it does

**Its day** is `client/shared/cat-life.js`: four-minute blocks (asleep, resting, sat up, about, flopped out, weighted by the hour) cut into 20-second turns (grooming, scratching, yawning, watching, kneading, sniffing, stalking, wandering, zoomies at dusk and dawn). It's a function of the cat's id and the clock, so the server and every client agree with no messages. `outgoing` and `impulsive` tilt it.

**Its beats** are RAM here, sent with the beast to the Room Stage:

- `greet`: somebody comes in (`zone.entered`). Unless it's asleep (and then only now and then) or not bothered (less likely the more outgoing it is), it trots to the door they came by, rubs round their legs and sits looking up at them. It gives up after a minute.
- `petted`: `pet` on it (the `npc.petAttempt` hook, which this plugin claims for its pets). It pushes into the hand and purrs.
- `cross`: enough strokes close together (five quick ones, or a good while under the chin). The third quick one twitches its tail and the fourth gets a look; then a growl and a swat, and it walks off. Then the count starts again.

- `petted` by spot: the engine's `pet` peels a spot off the end (`pet scrappy under the chin`) and hands it to `npc.petAttempt`. The ladder is points that fade (half-life 36 s), each spot weighing what it is to a cat: chin and cheeks hardly count, the back more, the tail and paws a lot, and the belly is a trap. Steady stroking answers with a `noop` until what he does changes. ROOM sends it as you stroke him with the mouse.

A beat change emits `pet.beat`, and plugins/roomstage sends the room's beasts again at once.

**His day in words**: a 5 s tick, while somebody's in the room, says what he does as it changes (settling, jumping up onto a piece or down off it, going to his bowls, and now and then a turn's act), from the same `catLife`, `catPerchOf`, `catSettle` and `catAtBowls` the picture plays. People's routines elsewhere skip an NPC with `flags.animal`.

**His bowls**: furniture with `flags.pet_bowls` naming the pet is his feeding station, drawn as the `petbowl` form. The `pet_bowls` table holds when each bowl was last filled (a row is written the first time a station is seen, and on a refill); how full they are and when he goes to them are worked out from that and the clock (`client/shared/cat-life.js`), and sent with the beast and on the piece (`room.pieceState`). `refill` charges ₵6 a dish and ₵1 a bowl for the share that's gone, at least ₵1.

## In ROOM

The Room Stage asks `roomstage.npcBeast` of every NPC with `flags.animal`. This plugin answers for a pet with `{ id, name, cat, pet, nature, beat? }`, and the stage puts it in `beasts` instead of `people`. The client (`gl/room-beasts.js` `catsFrame`) carves the four poses in a worker, skins the clips on the GPU (`gl/cat-gpu.js`, `gl/cat-clips.js`), walks the cat round the furniture between spots and voices it with CC0 recordings (`panels/room-cat-sound.js`).

## Adding a pet

1. An NPC file like `npc_pet_scrappy.json`: `flags.animal`, `flags.pet`, `home_zone`, `sex` (for he, she or it) and `wanders: 0`.
2. A pet file like `pet_scrappy.json` with the cat's numbers. Try them in the Cattery first (`/cattery.html` on the Modelshop).
3. `npm run content:import`.

## Future work

- Needs, bond and carers (`pet_state`, `pet_carers`), and the verbs `play`, `brush`, `call`, `name`, `blink`, `clean tray` (`feed` belongs to surveillance). The litter-tray recordings are already built.
- A tray and a scratching post in the flat for it to go to.
- A home that changes at runtime (given away, let out, taken in), as an override over the authored `home_zone`.

## Files

- `index.js`: loads `pets` and the bowls at boot, keeps the beats, answers `roomstage.npcBeast`, `npc.petAttempt` (by spot), `room.pieceState`, `furniture.acts` and `furniture.describe`, greets on `zone.entered`, says his day, and owns `refill`.
- `regress.js`: every pet has its NPC, resolves both ways, is drawn as a cat in its home and never as a person; its day is all clips it has; somebody coming in is greeted at their door; the petting ladder runs to the swat.
