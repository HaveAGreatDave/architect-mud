# The clone facility's depths

**Status: phase 1 built, the Vat Hall of phase 2 built; the rest is design.** The vat is built (see "Built" under phase 1), and so is the Vat Hall's room (see "The Vat Hall, built" under phase 2): and so are the gantry's animation and the tube arrival (see "The arrival, built"); the Newbie Hall, the test room and its elevator are design. Decisions of 2026-11-12 and 2026-11-16 below; where they disagree, the later one wins, and the layout section (the last) wins over both.

## What we're making

The clone facility is the first place every player sees and the place they come back to every time they die, so it gets more triangles than any other room in the game. Four changes:

1. **A new vat.** The vat model (`case 'vat'` in [gl/room-decor.js](../../client/game/js/panels/gl/room-decor.js)) is a lathed tube of flat see-through green with static balls for bubbles and a lathe body inside. It becomes a vat you'd believe: moving fluid, bubbles, caustics, refraction and a living sleeper.
2. **The test room, the Subject Pool.** In the basement, where clones volunteer for random tests for low pay. It's the first job the game tells a new player about. The tests, outcomes and prose are in [subject-pool-tests.md](subject-pool-tests.md), David's plan, which this doc builds on.
3. **The Newbie Hall.** The basement room where a new player is discharged from a vat for the first time, west of the test room. (It was the Stacks, on a second basement, until the layout decisions below.)
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

## Decisions (David, 2026-11-16)

The facility is the player's first look at the world, so it goes up by orders of magnitude, not a better vat in the same room. These amend the table above where they disagree.

| Question | Answer |
|---|---|
| How far the upgrade reaches | The street-level facility becomes several rooms, and every room's text prose is rewritten to the same bar as the 3D. The GLASS exterior (the `clone` arm) stays as it is |
| The street-level rooms | **The Vat Hall** (the print floor rebuilt as a tall nave of vats on gantries, where every respawn happens). The dressing bay and discharge hall were dropped in the layout decisions below |
| What's alive in it | Machines and organic life, no staff. Gantry arms, rail drones, sampling probes dipping into vats, pumps, a floor-cleaning bot; tissue and bioluminescent growth in the fluid and on the pipes. The facility runs itself |
| The look | A cathedral of vats: dark, tall spaces lit almost only by the vats, with caustics on the floor, light shafts and haze. The clinical part is the steel and tile |
| The liquid | A full volumetric simulation: a GPU fluid volume per near vat, so bubbles, the sleeper's breath and anything stirring the vat move real currents. Desktop only; phones get the shader-only tier |
| The Stacks after the first wake | Open to everyone, but your vat has been refilled with someone new |
| Where a lost arm, eye or nerve is fixed | At medical clinics round the city (Ironside Clinic, Co-Pay & Pray and the like), at a cost, or free by dying and reprinting. Never in the facility |
| Build order | The vat first, on today's print floor, so every respawn improves at once; then the rooms, the wake, the Pool |
| The sleepers | Full close-up ROOM figures, nude, in every vat. The mature layer's switch still decides the anatomy, as it does everywhere |
| The rooms' dressing | Every reworked room gets better floor and ceiling surfaces than today's plain tile and plaster, much more texture detail, and decals of many kinds throughout. It's crowded: the vats packed in among more vats, computers and plant, so the room reads as a machine in itself. Everything in it says something about the world the player has woken into |
| Signage | Every sign in the reworked rooms is redone, each one interesting and its own, lettered in the house font library ([fonts.md](../reference/fonts.md), `client/shared/fonts/`) |
| The sleepers' detail | Hands and feet worth looking at close up: loose, apart fingers, and bare feet with toes |

## Decisions (David, 2026-11-16): the layout

These replace the earlier tables wherever they place a room or a way between rooms.

| Question | Answer |
|---|---|
| Where a new player wakes | **The Newbie Hall**, the basement (z -1), in the plant room's place at 0,0,-1 under the Vat Hall. The plant room's pumps and tanks become its dressing |
| How a new player gets there | The tutorial's last room (the Collapse, `zone_the_collapse` on `map_prologue`) leads into the Newbie Hall, not the Vat Hall. The Newbie Hall gives a new player more of the tutorial's information before they go on |
| The test room | East of the Newbie Hall, at 1,0,-1: the Subject Pool's room, where the job is offered |
| The way up | An elevator between the test room and the Vat Hall. The stairs between the Vat Hall and the basement go, so a new player always passes through the test room on the way up |
| Where everyone else wakes | **The Vat Hall** (`zone_start`, 0,0,0), every death after the first, as now |
| The Vat Hall's way out | East, straight onto the street, as now. No dressing bay or discharge hall |
| The Vat Hall's vats | Two kinds. **Growing vats**, many of them, all full, each with a body growing in it. **Release vats**, four, always empty and waiting. Big tubes run from the growing vats to the release vats |
| The tubes | Every vat's tube, growing and release alike, rises from its crown to the ceiling, runs along the ceiling toward the middle of the room, and there turns up through it with all the others: one great bundle gathered over the centre of the hall, going up out of sight |
| How a respawn arrives | A body is grown in a growing vat, then slides down a tube into one of the four release vats. The release vat stands empty and dry until then: the body comes down its tube in a gush of fluid that fills the bottom of the vat and drains away through the drain under it. The vat opens and the gantry dresses them |
| Dressing | In the Vat Hall, by the dressing gantry: eight mechanical arms that take vat clothing from a bin with an endless supply of it and dress you in about five seconds. A dramatic animation with a lot of personality |
| Draining | Each vat drains through a drain in the floor directly under it |
| A new player's first dressing | In the Newbie Hall, by its own older, cruder dressing machine, on waking as now. The Vat Hall's eight-arm gantry is the one every respawn sees |
| The tablet and the Two-Cell poster | Both beats move down with the first wake: the tablet is issued in the Newbie Hall, and a copy of the poster hangs on its wall |
| Back down | The elevator runs both ways, so a returning player can go down to take the job again. The Newbie Hall stays open, its vat refilled with someone new |

## Phase 1: the vat

The 2026-11-16 decisions replace the faked fluid below with a simulated one. The shader's look (absorption, refraction, shafts, meniscus, glass) stays, and it now reads its colour and movement from a simulated volume:

- **The volume.** Each near vat has a small velocity, density and temperature grid (about 20×56×20 cells over its fluid column), kept as a flat 3D atlas in half-float textures so a step is one draw per pass. A step advects, adds buoyancy from the aerator ring at the base and from the sleeper's exhaled breath, solves pressure (Jacobi), and projects. The tube wall and the sleeper (a dozen capsules from its pose) are solid boundaries.
- **The bubbles.** A few hundred bubbles a vat, held in a texture and moved on the GPU by the volume's velocity plus their own rise, respawned at the aerator and at the mask. Drawn as small refracting spheres.
- **The surface.** A height field at the fluid's top, pushed by the volume's top layer and by impulses (a tap on the glass, the drain, the door), so the meniscus moves.
- **The march.** The fluid shader ray-marches the column through the volume: dye and temperature shade it, the light from the crown is scattered through it, and the march stops at the sleeper's capsules. What's behind is the room copied before the vat pass, sampled along the bent ray.
- **The tiers.** The two or three vats nearest the camera simulate every frame; the rest of the room's vats share one slow, looping volume baked at load; the Stacks' far tiers are shader-only. Without `EXT_color_buffer_float`, and on phones, every vat is shader-only.

**Built (2026-11-16).** [gl/room-vat.js](../../client/game/js/panels/gl/room-vat.js) is the layer: the grid, the aerator's six jets (bubbles rise from them in chains), the breath cloud at the mouth, the living haze shed off the skin, 256 particles a vat (a quarter of them drifting motes), the surface (a 32 x 32 wave equation pushed by the plume and dimpled where the jets' bubbles burst, which bends the view from above and breaks up the crown's light on its underside), and the march, with the room copied a vat's screen rectangle at a time before each vat is drawn, furthest first. room-decor.js records each vat on the mesh (`vats`: base, radius, full height, level, colour, piece id) and leaves the old static fluid in the glass, which room.js skips while the layer draws. Six vats simulate at once on a desktop; a drained vat doesn't.

The room is lit by its vats: each is a column of its fluid's colour in room.js's light (`uVat*`, up to six, nearest first), with moving caustics on the floor, walls and ceiling round it (off on a phone).

The sleeper is a close-up figure (room-stage.js `vatSleepers`): nude (`figure.wear` off for top, legs and shoes), in the `vatFloat` clip (actor3d.js: toes pointed, knees soft and unlike, arms floating off the body, head bowed, two breaths a cycle, a twitch of the right hand) with loose hands (room-people.js `GRIP.vatFloat`), always at the room's figure level whatever the distance, bobbing and turning a little, and built in the worker first (the vat stands empty until it's back). A bare foot at the close-up and lite levels has toes (figure.js `bareFootMesh`). Eleven capsules off its bones (`SLEEPER_CAPS`) are the fluid's walls and stop the march, pulled 30% inside the skin so a capsule standing proud of the body never shows as clear fluid. The crown lights the body from above, with the shafts moving across it. A breathing mask rides its face off the head bone, and a ribbed hose runs from it up to the crown, drawn solid before the fluid so the fluid bends them.

The row's look: `look.fluid` ('#rrggbb'), `look.level` (0 to 1), `look.sleeper: false` (room-layout.js passes them to the piece). `setLevel(id, k)` on the layer drains or fills a vat (the wake will drive it), stirring the fluid toward the drain and dropping the surface; `kick()` pushes the fluid at a point.

Not built: a `look.state: 'draining'` that runs by itself (the level is set from outside), a dynamic kick from anything in the room (a hand on the glass), and the slumping pose when a sleeper is left standing in air.

The rest of this section is the shader-only tier as first planned.

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

**The Vat Hall, built (2026-11-16).** `scripts/content/vat-hall.mjs` writes it: `zone_start` at 14 x 16 m and 8 m tall (the most a room may be), `ground: 'plant'` (sealed slab floor with drain channels, riveted steel panel walls, a services ceiling: `roomPlant`, `roomPanel`, `roomPlantCeiling` in gl/room-mesh.js), windowless, lit by four high strips and its vats. Twenty-two growing vats stand two deep down the walls (rows A and B), four release vats (`look.state: 'release'`: dry, grille floor lit amber) round the dressing gantry (`form: 'gantry'`, static for now) in the middle, six monitoring towers (`vatrack`) between the wall vats, a pump manifold (`manifold`) at each corner. Every vat stands over a drain, and every vat's tube climbs to the ceiling and runs in to one trunk over the middle (room-decor.js `drawVatTubes`). The street door is on the back wall, east.

**The arrival, built (2026-11-16).** A respawn plays in the Vat Hall on the respawn's own clock. The engine emits `vat.emerging` from `scheduleVatEmergence`; plugins/roomstage picks the next release vat in turn, stands the body just out of its front, opens the room for a player on the panels, and sends `room_vat`. The Stage plays it ([panels/room-vatcycle.js](../../client/game/js/panels/room-vatcycle.js)): a lit slug down the vat's tube (each vat keeps its tube's path, `vats[].path`), the gush (the vat a third full, churned from the crown), the drain, the glass revolving open (a release vat's glass is gl/room-vat.js's, not the mesh's), and the gantry turning to the vat: four arms dress the body, two fetch from the bin and hand over, one is held up like a waiter's, and one waves the body off toward the street, with a pat on the head to finish. The arms are the layer's (the gantry form keeps only its column, turret and bin) and telescope to reach. Anybody watching sees the body in the vat, bare until it's dressed at 5.6 s, shivering once drained; the arriving player sees it from inside the vat, under the fluid and then on their feet, and is handed back just out of the vat at 9 s. With nobody arriving, the gantry idles: its arms breathe, its turret drifts, and every 17 seconds an arm goes and tidies the bin.

Its walls and floor carry 44 marks (`flags.room.decor.marks`, painted by [panels/room-marks.js](../../client/game/js/panels/room-marks.js) in the house font library and laid as decals beside the stadium signs): wayfinding, warning labels, hazard placards, servicing tags, LED readouts (a painted board with lit words, so the board shows), wall and floor stencils, corporate posters, scrawls, and stains, run down a wall or soaked into the floor. A mark is `{ kind, wall, at, y }` or `{ kind, floor: [u, v], turn }` with `w`, `h`, `text`, `sub`, `font`, `tint`; the kinds and their defaults are in the module's header.



New zones on the facility's interior map (`map_int_1782352518150`), with connection files, power zones, fixtures and lights in the same build.

**Every room is dressed, not just furnished, and reads as a machine.** Today's print floor is six vats, a bench and two posters on plain tile under plain plaster. The vats stand crowded among more vats, computers, manifolds and plant, with cable and pipe running between them, so the room looks like one machine you're standing inside. Surfaces carry far more texture than now, and decals of many kinds are everywhere: stencils, part numbers, warnings, fluid stains, scuffed walk lines, inspection tags, graffiti a technician left. Every sign is redone and lettered in the house font library. Each reworked room gets floor and ceiling surfaces worth looking at (drained grating over lit sumps, stained and patched tile, cable trays, ducting and gantry rails overhead), and is crowded with equipment and detail besides the vats: monitoring stacks and readouts, pumps and manifolds, sample racks, cold stores, tissue cultures, gantry arms, rail drones, the cleaning bot, maintenance access, warning stencils, corporate signage, old fixes and later fixes over them. Each piece should tell the player something about the world: who runs this, what a body costs, what the city wants from a clone, what went wrong here before.

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

**Where the damage is fixed.** "Limb Restoration Services, Level 2", "the infirmary" and "regenerative care" are the city's medical clinics (Ironside Clinic, Co-Pay & Pray and the like), which repair a lost arm, a nerve or an eye at a cost. Dying and reprinting also clears them, for nothing. The facility repairs nothing. The clinics' repair service ships with these outcomes, or they wait for it.

## Open

- ORACLE's voice for the grille: which preset, and the lines of the first telling.
- The Stacks' sound: pumps, fluid and the hum of a few thousand vats, for SIREN.
- The street-level rooms' layout: the Vat Hall's height and tiers, where the dressing bay and discharge hall sit, and which of today's furniture moves where.
