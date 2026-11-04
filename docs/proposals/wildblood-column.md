# The Wildblood column

> **Status: phase 1 built (2026-11-03): three rigs on a timetable, look only.** The hounds, rider
> figures, shadowing and any raid are design (see [Later phases](#later-phases)).

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

## Later phases

1. **Bracken's hounds**, running out front: a four-legged fauna kind, since `FAUNA_KINDS` is birds
   only (see [systems-fauna.md](../systems-fauna.md)).
2. **Rider figures**, with order dress moved out of `tools/modelshop/actor-lab.html` into content.
3. **Shadowing:** the hound-runner keeps pace with a truck on the corridor for miles and never
   closes.
4. **A raid**, which waits on `quest_wild_hunt` and the order build sequence.
