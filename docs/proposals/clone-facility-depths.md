# The clone facility's depths

**Status: design.** Nothing here is built yet. The print floor (`zone_start`) and the plant room (B1) are built; this doc covers the new vat, a second basement with the Subject Pool on it, and the room a new player first wakes in.

## What we're making

The clone facility is the first place every player sees and the place they come back to every time they die, so it gets more triangles than any other room in the game. Four changes:

1. **A new vat.** The vat model (`case 'vat'` in [gl/room-decor.js](../../client/game/js/panels/gl/room-decor.js)) is a lathed tube of flat see-through green with static balls for bubbles and a lathe body inside. It becomes a vat you'd believe: moving fluid, bubbles, caustics, refraction and a living sleeper.
2. **B2, the Subject Pool.** A second basement under the plant room, where clones volunteer for random tests for low pay. It's the first job the game tells a new player about. The tests, outcomes and prose are in [subject-pool-tests.md](subject-pool-tests.md), David's plan, which this doc builds on.
3. **The Stacks.** A room off B2, where a new player wakes for the first time: a grated catwalk halfway up a shaft of vats that run above and below into the dark.
4. **The first wake**, played in ROOM from inside the vat.

## Decisions (David, 2026-11-12)

| Question | Answer |
|---|---|
| Where the new level goes | B2, under the plant room. The plan's "Sublevel B3" is this floor |
| How you get there | Stairs from B1 as now, and a freight elevator from the print floor to B2, with the plan's laminated sign zip-tied to its gate |
| Who wakes in the Stacks | A new player, once. Every later death reprints you on the print floor (`anchor_zone` stays `zone_start`) |
| The Stacks' feel | Rows and tiers of occupied vats running off into the dark, one of them yours |
| Where you wake | On a catwalk halfway up, vats above and below into the dark. A door through to B2 |
| What the experiment floor is | The Subject Pool, as [subject-pool-tests.md](subject-pool-tests.md) lays it out |
| Who tells a new clone about the job | The holding room's speaker grille, in ORACLE's voice. No human anywhere in the Pool; Pell is the only face, from visit 2 |
| How the tests are drawn | One test cell behind the holding room's far wall, dressed in ROOM for whichever test rolled, from about ten rigs that cover all 26. The rounds play as text over it |
| The outcome effects | All of them, in two passes: the statuses, stat changes and deaths first, then the effects that change the interface |
| The first wake | Played in ROOM from inside the vat |
| Liquid and vat effects | Bubbles and particles, caustics, refraction, living sleepers |
| Fluid colour | Green on the print floor, as now; amber in the Stacks, so the first wake looks unlike any respawn |
| Phones | A reduced tier: fewer vats drawn in the Stacks, no caustics, cheaper bubbles. Same rooms, same wake |

## Phase 1: the vat

A vat stops being lathed quads and becomes its own layer, `gl/room-vat.js`, drawn by [gl/room.js](../../client/game/js/panels/gl/room.js) in the glass pass, with a clock. The room shader has no time uniform today, which is why everything in the current vat stands still.

**The fluid.** One shader draws a vat's fluid column. Per pixel it intersects the eye ray with the cylinder, so it knows how far the ray travels through fluid, and:

- tints by that distance (Beer-Lambert absorption), so the middle of the column is deeper in colour than the edges and the sleeper fades into it;
- bends what's behind: the room is copied to a texture before the vat pass and sampled along the fluid's refracted ray, so the sleeper and the far wall shift as you move;
- draws bubble columns rising from the base, wobbling as they rise, and specks drifting slowly, all in the shader from the vat's seed and the clock, with no per-bubble geometry;
- draws light shafts down the column from the crown lamp, brighter near the axis, with slow noise moving through them;
- draws the surface at the top: a meniscus where it meets the glass and a slow ripple.

**The glass.** A thick wall with fresnel, a long highlight down the curve, and condensation on the outside: a noise mask of small droplets, with an occasional run.

**Caustics.** The room shader gets a clock and a list of the nearest vats (position, radius, colour, up to 8). Within a few metres of each, the floor, walls and ceiling get a moving caustic pattern in the fluid's colour, added to the diffuse light. Off on phones.

**The sleeper.** The close-up figure ([gl/figure-hd.js](../../client/game/js/panels/gl/figure-hd.js), [hd-figure.md](hd-figure.md)) replaces the lathe body: naked, floating a little off the floor, head bowed, arms loose, knees soft, weighted and a little asymmetric, never straight up and down. It breathes slowly, its hair drifts, and now and then it twitches. A mask and a line run up to the crown. It's drawn before the fluid, so the fluid bends and tints it.

**Cost.** Near vats get everything. Far vats (the back of the Stacks) get the fluid shader at a cheaper setting and a baked sleeper silhouette instead of the figure, and the furthest are dark shapes in the fog. Phones get the reduced tier. The fluid shader has one call site, so its GLSL isn't inlined several times (the D3D crash).

**What stays.** `look.form: 'vat'` keeps its name and its row fields, and gains `look.fluid` (a colour, default green), `look.sleeper` (default true) and `look.state` (`full`, `draining`, `drained`). The six vats on the print floor get the new model with no content change.

## Phase 2: the rooms

New zones on the facility's interior map (`map_int_1782352518150`), with connection files, power zones, fixtures and lights in the same build.

**The freight elevator.** A car from the print floor to B2 on the elevator plugin, which ROOM already draws. The laminated sign is on its gate: COMPENSATED WELLNESS STUDIES. NO EXPERIENCE NECESSARY. CONTINUITY OF SELF NOT GUARANTEED.

**The holding room** (B2, `grid_z -2`). The plan's room: white tile floor to ceiling, a drain in the centre that's slightly too large, a bench bolted to the wall, a speaker grille, a wall slot that prints receipts, a tray that slides out of the wall. Its far wall unseals onto the test cell. Stairs up to B1, the freight elevator, and a door through to the Stacks.

**The test cell** (off the holding room, through the far wall). One room whose ROOM dressing is set by the test that rolled, from these rigs:

| Rig | Tests |
|---|---|
| Steel chair with cuffs, floor panel, ceiling sprays | thermal tolerance, neuromuscular stimulation, ocular reflex, auditory saturation, aversive conditioning |
| Surgical table under a lamp | limb reattachment, nociceptive mapping, suture tolerance, tissue regrowth |
| Steel slab under a hydraulic press | structural load |
| Recliner with a drip stand | pharmacological screening, control group |
| Tank with a lid or a harness | sensory isolation, dive reflex |
| Steel cabinet stood on end | cryogenic recovery |
| Round chamber with a vault door and porthole | barometric decompression |
| Glass booth with a floor vent | toxin challenge |
| Office: desk, carpet, plant | continuity verification, actuarial assessment, compliance, caloric deprivation (with a cot) |
| Mirrored room with a chair | restraint and observation, self-recognition |
| Bedroom: one bed, a nightstand | termination baseline |
| Long dim room with a curtain and a chain | predator proximity |
| Room with a table, a bowl and nine paper gowns | allocation lottery |

The far wall shuts behind you, so nobody else sees the cell dressed for your test.

**The Stacks** (off B2). A new kind of room for ROOM: a catwalk across a shaft instead of a floor between four walls. The catwalk is grating you can see through. Past its rails, vats stand in tiers on gantries, above you into the dark and below you into the dark, each lit by its own amber fluid. Your vat stands on the catwalk, drained, its front swung open. A door at one end goes through to the holding room. This needs ROOM to draw past its own walls (the shaft, the tiers, fog) and to draw a see-through floor.

## Phase 3: the first wake

A sequence in the shape of [room-morphex.js](../../client/game/js/panels/room-morphex.js) (`frame(now)` hands the stage a camera, props, glass and glows), as `room-vatwake.js`:

1. Dark. Your eyes open inside the vat: the camera is in the fluid, everything amber and bent, the catwalk and the far tiers warped through the curved glass. Bubbles go past your face.
2. The fluid drains. Its surface comes down past your eyes, and the picture goes from inside the fluid to wet air.
3. The front panel swings open, and you stumble out onto the catwalk.
4. The dressing gantry dresses you, as now.

The prologue's text beats (`plugins/prologue/index.js`, from "You wake.") play over it unchanged, on the same timers. The prologue sends the player to the Stacks instead of `zone_start`, and the client plays the wake when they arrive. The textgames and log rungs get the text, as now.

The way out passes through the holding room, where the speaker grille tells the new clone the job exists (phase 4), then up the stairs or the freight elevator to the print floor and the street. The prologue's later beats (the tablet, the Two-Cell poster) carry on from the print floor as they do now.

## Phase 4: the Subject Pool

A plugin, `plugins/subjectpool/`, that runs [subject-pool-tests.md](subject-pool-tests.md): the content warning and `volunteer confirm`, the sign-on stipend, the weighted roll (with `unlock` against prior visits), timed rounds, the `endure`/`scream`/`comply` prompts shifting the odds, outcomes, hazard pay, the escalating cooldown and streak bonus, discharge with the receipt, findings appended to the player's subject file, and Pell from visit 2. Deaths go through the normal death path, so respawn rules and what you were carrying behave as they always do; the termination baseline pays your next instance.

**The first telling.** The first time a clone passes through the holding room, the speaker grille says what the job is, in two or three lines in ORACLE's voice, and points at `volunteer`. It says it once per player.

**The tests' data.** The 26 tests become content, one JSON file per test, so they can be tuned without code. The plugin reads them and owns no prose.

**The outcome effects, pass one:** everything that's a status, a timed modifier, a stat change, damage, a description note or death, on the existing survival statuses where one already fits and new ones where not.

**The outcome effects, pass two:** the ones that change what the player sees or types: blank or cut-short room descriptions, wrong descriptions that correct themselves, garbled or missing `say`, a dropped letter, a command replaced by an emote, a name shown as a clone ID, rooms removed from the map history. Each needs a seam in look, say or dispatch, and each seam is a hook a plugin can use, not code that knows about the Pool.

**Gaps in the world the plan names.** "Limb Restoration Services, Level 2", "the infirmary" and "regenerative care" are where an arm, a nerve or an eye gets fixed. None exists in Coldwater yet; the Long Watch has an infirmary of its own. Those outcomes need somewhere to be fixed before they ship, or they stay until death.

## Open

- ORACLE's voice for the grille: which preset, and the lines of the first telling.
- The Stacks' sound: pumps, fluid and the hum of a few thousand vats, for SIREN.
- Whether the Stacks stays open to everyone after the first wake, or seals behind a new player.
- Where in Coldwater a lost arm, eye or nerve gets fixed.
