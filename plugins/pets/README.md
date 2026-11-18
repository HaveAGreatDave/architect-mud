# pets

**Status: phase 2 started.** The table, the pet as an NPC, the cat in ROOM moving all day and up on the furniture, his day said in the text world, the greeting at the door, the petting ladder by spot, his bowls and `refill`, hunger and thirst from the bowls, and his litter tray and `scoop` are built. Carers, bond and the other pet verbs are design. The full design is [docs/proposals/pets.md](../../docs/proposals/pets.md).

A pet is two rows:

- **Its NPC** (`content/npcs/`, `flags.pet` naming its pet row, `flags.animal` true). This is the animal in the text world. The engine lists it in the room, `look` and `pet` work on it, and boot puts it in its `home_zone`. Give it `wanders: 0` so it stays home.
- **Its row in `pets`** (`content/pets/`): `npc_id`, `species`, `look` (the cat kit's numbers, `client/game/js/panels/gl/cat-kit.js` `catLook`) and `personality` (the Feline Five).

## What it does

**Its day** is `client/shared/cat-life.js`: four-minute blocks (asleep, resting, sat up, about, flopped out, weighted by the hour) cut into 20-second turns (grooming, the cello wash with a hind leg up, scratching, yawning, a head shake, a slow blink, watching, kneading, sniffing, stalking, rubbing his cheek on the furniture, a hairball now and then, rolling on his back, dreaming, wandering, zoomies at dusk and dawn). It's a function of the cat's id and the clock, so the server and every client agree with no messages. `outgoing` and `impulsive` tilt it.

**Its beats** are RAM here, sent with the beast to the Room Stage:

- `greet`: somebody comes in (`zone.entered`). Unless it's asleep (and then only now and then) or not bothered (less likely the more outgoing it is), it trots to the door they came by, rubs round their legs and sits looking up at them. It gives up after a minute.
- `petted`: `pet` on it (the `npc.petAttempt` hook, which this plugin claims for its pets). It pushes into the hand and purrs.
- `cross`: enough strokes close together (five quick ones, or a good while under the chin). The third quick one twitches its tail and the fourth gets a look; then a growl and a swat, and it walks off. Then the count starts again.

- `petted` by spot: the engine's `pet` peels a spot off the end (`pet scrappy under the chin`) and hands it to `npc.petAttempt`. The ladder is points that fade (half-life 36 s), each spot weighing what it is to a cat: chin and cheeks hardly count, the back more, the tail and paws a lot, and the belly is a trap. Steady stroking answers with a `noop` until what he does changes. ROOM sends it as you stroke him with the mouse.

A beat change emits `pet.beat`, and plugins/roomstage sends the room's beasts again at once.

**His day in words**: a 5 s tick, while somebody's in the room, says what he does as it changes (settling, jumping up onto a piece or down off it, going to his bowls, and now and then a turn's act), from the same `catLife`, `catPerchOf`, `catSettle` and `catAtBowls` the picture plays. People's routines elsewhere skip an NPC with `flags.animal`.

**Two cats**: where two pets share a room, the same 5 s tick works out what two of them do together (`catMeets` in `client/shared/cat-life.js`: a greeting, grooming, sleeping in a heap, play or a spat, from their ids, natures and the clock) and says it once as it starts (`MEET_LINE`); neither cat's own day is said while it runs. The client stages it (`gl/cat-meet.js`, `gl/room-beasts.js`) from the same answer, so nothing is sent.

**His bowls**: furniture with `flags.pet_bowls` naming the pet is his feeding station, drawn as the `petbowl` form. The `pet_bowls` table holds when each bowl was last filled (a row is written the first time a station is seen, and on a refill); how full they are and when he goes to them are worked out from that and the clock (`client/shared/cat-life.js`), and sent with the beast and on the piece (`room.pieceState`). `refill` charges ₵6 a dish and ₵1 a bowl for the share that's gone, at least ₵1.

**Hunger and thirst** (`catNeeds` in `client/shared/cat-life.js`) are worked out when read, from when he last ate and drank: the last of his goes since the bowl was filled that found something in it. Nothing for a few hours after a meal, then rising to 1 after a day without. Hungry at an empty dish he goes back to it every half hour or so to complain (a `pester` go), greets whoever comes in by demanding food (the greet beat carries `hungry`), and `examine` says it (`npc.describeAnimal`). Thirsty at an empty water bowl, half those goes he jumps onto the kitchen sink and drinks from the tap instead.

**His tray**: furniture with `flags.pet_tray` naming the pet, drawn as the `littertray` form. The `pet_trays` table holds when it was last scooped; every go since (`trayTimes`: three or four pees and one or two of the other a day, in real time) is worked out from that, so nothing is written while he goes. Past four goes he sniffs it over first; past seven he won't get in and goes on the floor in front of it, and the room smells (`zone.smells`). `scoop` clears it, free. In ROOM he hops in over the rim, digs, turns round, squats, sniffs and covers (`pee` and `poo` in `gl/cat-clips.js`), and after the other he sometimes tears round the flat.

## Street cats

`strays.js`. A stray is a row in `stray_cats` and an NPC in RAM only, built from the row at boot (no npcs row, so a content deploy never touches it). With the table empty, boot rolls a batch of twelve onto Coldwater's walkable outdoor tiles, weighted to the east and most of all to the slum, where people feed them (the slum's tiles count six times, the yards twice, the docks, residential and industrial half again). Each is a moggy most of the time, sometimes a breed, with a rolled coat, build and nature, and a name no other stray on the street has.

**Their day on the street**: a 5 s tick, only on tiles somebody's on, gives each stray a line about every two minutes, picked from its id and the clock (`streetLine`): lounging on a bin or in the sun, washing, stalking pigeons and now and then catching one, drinking from a puddle or a drainpipe, sheltering or drinking fresh rain when it's raining, eyes in the dark at night. In the slum and the other poor quarters people feed them: a named NPC on the tile puts out a saucer or tips a tin, or with nobody there a window opens and scraps land on the pavement. Nobody feeds them in Halcyon Fields.

**`adopt <cat>`** takes the stray you're standing by home to your flat (the first in `apartments` you own), up to three. The claim is one UPDATE guarded on `adopted_by IS NULL`, so two people can't take the same cat. Adopted, it joins PETS with the flat as its home and is a pet from then on. It has no bowls or tray until you put some down.

**The Strays dev tab** (`panel.js`, GET `/strays`) lists every stray, where it is and who took it in; **Roll a new batch** (POST `/strays/generate`) puts another lot on the streets, and **remove** (DELETE `/strays/<id>`) takes one out of the world.

## In ROOM

The Room Stage asks `roomstage.npcBeast` of every NPC with `flags.animal`. This plugin answers for a pet with `{ id, name, cat, pet, nature, beat?, bowls?, tray? }`, and the stage puts it in `beasts` instead of `people`. The client (`gl/room-beasts.js` `catsFrame`) carves the four poses in a worker, skins the clips on the GPU (`gl/cat-gpu.js`, `gl/cat-clips.js`), walks the cat round the furniture between spots and voices it with CC0 recordings (`panels/room-cat-sound.js`).

## Adding a pet

1. An NPC file like `npc_pet_scrappy.json`: `flags.animal`, `flags.pet`, `home_zone`, `sex` (for he, she or it) and `wanders: 0`.
2. A pet file like `pet_scrappy.json` with the cat's numbers. Try them in the Cattery first (`/cattery.html` on the Modelshop).
3. `npm run content:import`.

## Future work

- Bond and carers (`pet_carers`), the needs past hunger and thirst (tiredness, boredom, grooming), and the verbs `play`, `brush`, `call`, `name`, `blink` (`feed` belongs to surveillance).
- A scratching post in the flat for it to go to.
- A home that changes at runtime (given away, let out, taken in), as an override over the authored `home_zone`.

## Files

- `strays.js`: street cats, `adopt` and the `/strays` routes. `panel.js`: the Strays dev tab.
- `index.js`: loads `pets`, the bowls and the trays at boot, keeps the beats, answers `roomstage.npcBeast`, `npc.petAttempt` (by spot), `npc.describeAnimal`, `room.pieceState`, `furniture.acts`, `furniture.describe` and `zone.smells`, greets on `zone.entered`, says his day, and owns `refill` and `scoop`.
- `regress.js`: every pet has its NPC, resolves both ways, is drawn as a cat in its home and never as a person; its day is all clips it has; somebody coming in is greeted at their door; the petting ladder runs to the swat; every breed builds; hunger rises with an empty dish and the greeting demands food; the tray fills, goes beside itself when full, smells, and `scoop` empties it; two cats meet the same for everybody, friends get on and rivals don't, and every line is filled in.
