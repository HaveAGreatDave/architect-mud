# The Wildblood column

> **Status: phase 1 built (2026-11-03): three rigs on a timetable, look only. Phase 2 built
> (2026-11-03): Bracken's hounds running in front.** Rider figures, shadowing and any raid are
> design (see [Later phases](#later-phases)).

The town's road traffic: the Howl, the hound-runner and the Slake cart, running a loop from the
Deadleg yard to the Slake and up to the North Gate. It came from the 2 November concept art (the
"Wildblood Cel Concepts" and "Wildblood Concept Art" artifacts). The canon is in
[lore-wildblood.md](../lore-wildblood.md#the-column).

## What's built

- **Three meshes**, one class: `column` (the Howl), with `variants` `runner` →
  `column_runner` and `cart` → `column_cart` (`content/vehicle_models/mesh_column*.json`). They're
  written by [scripts/shapes/concepts/wildblood-column.mjs](../../scripts/shapes/concepts/wildblood-column.mjs);
  edit that, never the JSON.
  - **The Howl:** a Mule fuselage strapped to a five-axle chassis, with the Halcyon stripe crossed
    out in ash, sawn-off wing roots, the kept tail fin with a skull chain, two open stacks fed from
    fungal bladders, a spiked bull bar and plough, and a drone staked on a pole.
  - **The hound-runner:** a V-twin with one upswept stack and a skull over the lamp, towing an empty
    dog cage.
  - **The Slake cart:** a tanker with a riveted skirt, crown spikes, a catwalk, hose reels, a ladder
    and a rack of glass test tubes.
  - Each rig carries masked riders: bone masks lined with quilt, Halcyon goggles, a tyre-tread
    pauldron. One rider on the Howl has a thornhide arm.
- **The route and the clock:** [plugins/column](../../plugins/column/README.md). Where the rigs are is
  a pure function of the clock, so nothing is stored. Seats see them through `vehicle.contacts`, and
  people on foot get a line as they pass.
- **The sound:** the `rotgas` voice in `seat-audio.js`, louder and rougher than a truck's.
- **Bracken's hounds** (phase 2): a pack of four to six (six, off `HOUND_SEED`) running 0.8 to 1.5
  tiles ahead of the Howl along the loop, a little either side of the rigs' lane. They're fauna, not
  vehicles: the first four-legged kind, `quadruped`, with the one row `hound`
  (`content/fauna_models/quadruped_hound.json`, baked by `npm run fauna:bake`). See
  [systems-fauna.md](../systems-fauna.md#the-hounds-four-legs).
  - **Where they are** is `houndsAt(nowMs)` in `client/shared/column-route.js`, the column's own
    clock. The route's arithmetic moved there from `plugins/column/route.js`, and the plugin imports
    it. Each hound's spread, line, weave and stride are hashed off the seed.
  - **At a stop** the pack is held short of the stop as the Howl closes, waits, and lies down in
    front of the plough while the column stands. When the column pulls away it runs back out to its
    spread over nine seconds, so nothing jumps. The cage stays empty.
  - **Round a corner** a hound's lane is eased over the last 0.3 tiles in and out, so at the two
    turnarounds it swings round the end of the U-turn instead of stepping across the road.
  - **The model:** a deep-chested, thin-waisted dog with a heavy neck and jaw, a bone collar and
    amber eyes, coat over a tan underside. The gallop is a rotary gallop on the sixteen beat rows
    gl/fauna.js already draws, with the feet solved onto the road and a suspension at the end of the
    stride. 104 faces a dog.
  - **Drawn** by `drawHounds` in windshield.js: a record into the fauna sink on GLASS 2,
    `paintFauna` on GLASS 1, out to 9 tiles, from the ground only. Each column contact carries
    `clock`, and the seat takes its own clock's skew off it, so the pack runs in front of the Howl
    it's drawing.
  - **Day only**, like the birds: the fauna layer has no night tint, so a dog after dark would glow.
  - **No bark** yet.

## Rules

- **Authored in metres, scaled to 7.2 m a unit**, the podracer's ground-seat metre, with
  `contactSize` 0.3333. All three keep their tyre bottoms on h = 0, because the renderer rests a
  ground contact by its class mesh's lowest point, which is the Howl's.
- **No words on the rigs.** Hood tallies and ash handprints only. A stroke is a Gift and a ring is a
  Lesson.
- **Salvaged headlamps** are the one exception to the region's fire-only light
  ([building-styles.md §3.3](../reference/building-styles.md#33-the-wildblood--the-scarletwastes-and-the-thornwarren--built)).
- **Bytes matter.** The meshes ship in `vehicle-meshes.js`, which every 3-D seat downloads, so
  cylinders are the `tube` primitive and rivets and paint marks are single faces. Written out as
  faces, the first cut added 915 KB; it now adds about 414 KB.
- **The yard is the Deadleg**, not "the Roadhead", which is the Terminus depot. Trucks run on diesel,
  so nothing calls the city hydrogen-quiet.
- **A hound is fauna, never a contact.** Its place comes from a clock both sides agree on, like a
  flock, and an animal filed as a vehicle arrives at liveries, lamps and gear (see the note in
  `fauna-model-schema.js`).
- **The hounds are on the world's scale and the rigs aren't quite.** A dog is drawn at `FAUNA_TILE`,
  17.9 m a tile; a rig at 7.2 m a unit and `contactSize` 0.3333 is 21.6 m a tile. So beside the Howl
  a dog reads about a fifth bigger than it would beside a rider. Judge it in a seat.

## Later phases

1. **Bracken's hounds**: built (see above). Still to do: a bark off the same clock, a lie-down that
   moves instead of changing pose in one frame, and a night tint for the fauna layer so the pack can
   run after dark.
2. **Rider figures**, with order dress moved out of `tools/modelshop/crowd-lab.js` (the Figure Lab's Street renderer) into content.
3. **Shadowing:** the hound-runner keeps pace with a truck on the corridor for miles and never
   closes.
4. **A raid**, which waits on `quest_wild_hunt` and the order build sequence.
