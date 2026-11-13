# pets

**Status: phase 2 started.** The table, the pet as an NPC and the cat in ROOM are built. Needs, carers and the pet verbs are design. The full design is [docs/proposals/pets.md](../../docs/proposals/pets.md).

A pet is two rows:

- **Its NPC** (`content/npcs/`, `flags.pet` naming its pet row, `flags.animal` true). This is the animal in the text world. The engine lists it in the room, `look` and `pet` work on it, and boot puts it in its `home_zone`. Give it `wanders: 0` so it stays home.
- **Its row in `pets`** (`content/pets/`): `npc_id`, `species`, `look` (the cat kit's numbers, `client/game/js/panels/gl/cat-kit.js` `catLook`) and `personality` (the Feline Five).

The Room Stage asks `roomstage.npcBeast` of every NPC with `flags.animal`. This plugin answers for a pet with `{ id, name, cat }`, and the stage puts it in `beasts` instead of `people`. The client (`gl/room-beasts.js`) carves each pose in a worker. The cat holds still while it's settled: skinning costs 60 to 130 ms, so it's done once per settle, and the idle (breathing, ears, the blink) waits for skinning on the GPU. Where it settles and how it lies there come from the clock and its id, so everyone sees the same cat: every four minutes it takes another spot and another pose. It's moved there, not walked.

## Adding a pet

1. An NPC file like `npc_pet_scrappy.json`: `flags.animal`, `flags.pet`, `home_zone` and `wanders: 0`.
2. A pet file like `pet_scrappy.json` with the cat's numbers. Try them in the Cattery first (`/cattery.html` on the Modelshop).
3. `npm run content:import`.

## Future work

- Needs, bond and carers (`pet_state`, `pet_carers`), and the verbs `feed`, `play`, `brush`, `call`, `name`, `blink`, `clean tray`.
- Skinning on the GPU, so the idle can play in the room.
- Walking between spots, and clips picked by the server from the needs.
- A home that changes at runtime (given away, let out, taken in), as an override over the authored `home_zone`.

## Files

- `index.js`: loads `pets` at boot and answers `roomstage.npcBeast`.
- `regress.js`: every pet has its NPC, resolves both ways, is drawn as a cat in its home and never as a person.
