# The model's plan: what a building knows about its own inside

**Status: phase 1 built (a building's own mass only; neighbours and parts arms draw by hand are design). Phase 2 is design. Phase 3 is started: its generator runs on plans written by hand, writing into content/ for review as a git diff.**

A GLASS arm already records its masses (`SHAPE_SINK`, [building-shapes.md](../reference/building-shapes.md)). This proposal has it record two more things: which of its faces touch another mass, and where its floors and bays fall. Phase 1 uses the first to stop details landing on walls that aren't outside. Phases 2 and 3 use both to lay a building's rooms out from its model, the way Introversion's *Subversion* derived interiors from exteriors and CityEngine's CGA rules split a mass into floors and bays (Müller and Wonka, 2006; see the [bibliography](../reference/bibliography.md)).

It isn't a performance plan. The frame on foot is CPU-bound on records streamed each frame and the GPU is 22 to 43% busy ([sixty-fps.md](sixty-fps.md)), so taking hidden faces out of the bake saves a fraction of the 1.8 ms the mass costs the GPU. Distance LOD from recorded segments is already built (`drawModelLOD`, 83% fewer faces at range). The performance levers are in sixty-fps.md and [glass-worker.md](glass-worker.md).

## Why

- **Details land on walls that aren't outside.** A `balcony` or `fireEscape` on a back face projected into the building until the Marrow build; window bays end up on party walls and inside wings. Each one is found by eye and fixed one at a time.
- **Rooms are fitted by hand.** "Rooms fit the model" is the rule, and it's kept by a script per building: `yards-fit.mjs`, `embassy-hotel-rooms.mjs`, `meridian-refit.mjs`, `solenne-plates-fit.mjs`, `echelon-fit.mjs`. Each one reads numbers off the model by hand (the Yards' shaft is 14.3 m to 27.6 m at this tile's seed, then 11.8 m) and breaks when a tile move re-seeds the building.
- **Multi-tile buildings need shared floor lines.** The Solenne's plates and the Coliseum's plan each solve this in their own table. The next one shouldn't need a third.

## Phase 1: occlusion queries in the arm

Give an arm a question it can ask before drawing a facade detail: is this face, at this height, outside?

### What was built (2026-11-25)

The census came first. Over every model in the registry at eight seeds, 2,172 of 80,534 parts in `derivedTrim`'s rich list (2.7%, in 83 models) had their face inside another of the building's own boxes: 1,259 window bays, 401 balconies, 194 vents, 152 louvres, 72 shutters, 68 fire escapes and 26 AC units. The bank is typical: of its 52 parts, 17 sat behind the portico block or inside its columns.

- **`partBuried(d, boxes, V)`** in [derived-kit.js](../../client/game/js/panels/glass/derived-kit.js) probes a part's face at three points across its width, just off the wall and at its reach, against the building's boxes as `segFit` fits them (`buryBoxes`). Half the probes inside one box and it's buried. Doors are never dropped, since the street door reads their bay.
- **`derivedTrim` drops buried parts** from the finished list, behind `RENDER_TUNE.buriedDrop` (on; it's in the list's cache key). One place, so the 2-D painter, the mesh, the light and sign passes and the Lite bake all lose the same parts.
- **The gate**, [buried.mjs](../../scripts/shapes/buried.mjs), in the shapes group: it counts with the switch off (zero there fails, as the control), then fails anything still buried with it on. `node scripts/shapes/buried.mjs --list` prints each part.
- The picture doesn't change where the part was wholly hidden; it changes where one stuck out through the mass in front of it. `shapes:smoke`, `anchored`, `glmesh`, `signfit`, `tagfit`, `glself` and `modeldiff --determinism` pass, and Lite was re-baked (`lite/smoke.mjs` passes).

Not done from the plan below: neighbouring tiles' buildings, parts an arm draws by hand through `drawArmPart` (not in the list), and a `faceOpen` helper for arms to ask before drawing. The filter answers the question after the fact, which is enough for the kit and authored lists.

### As designed

- **The answer comes from the capture.** `captureShape` already runs the arm against a stub with `SHAPE_SINK` set. A first pass records the masses; the query reads them. On a real frame the arm asks the cached capture for its tile and seed, never runs a second capture.
- **Neighbours count.** A face against the tile next door is shut if that tile's building reaches it. That reads the neighbour's capture by its plot line (`segFit`), not its arm.
- **One helper, `faceOpen(face, z0, z1)`**, returns the open intervals along the face. `windowBay`, `balcony`, `fireEscape`, `awning` and the derived kit call it; an arm drawing by hand can call it too.
- **Gate.** A `shapes:smoke` check fails any recorded window, balcony or fire escape that lands inside another mass. Run it over every arm first as a census: the count of hits is the size of the problem, and the phase is worth doing only if it isn't near zero.
- **Lite.** Faces that are dropped drop out of the bake; re-bake and `lite/smoke.mjs` as usual.

## Phase 2: the arm records its plan

Add a fifth sink, `PLAN_SINK`, the same trick as the other four. With it set, the primitives that split a mass record the split:

- **Floors**: each mass's storey lines, as affine triples like every other recorded scalar (`a·fh + b·h + c`), so they rescale with the tile's seed without running the arm again.
- **Bays**: each facade's bay lines and which bays are glazed, from `windowBay` and the facade grid.
- **Doors**: the street door from `markDoorway`, already recorded for [street-doors.md](../reference/street-doors.md).
- **Shared walls**: from phase 1.

The output is one plan per building: for each floor, its outline, its outside faces with their windows, and its shared walls. Multi-tile buildings record one plan across their tiles, and a floor line on one tile snaps to the nearest on the next (CGA's snap lines), which is what the Solenne's plates do by hand.

A gate, `model-plan.mjs`, checks the plan against each building's existing rooms: every room's floor height within a storey line, every room's `flags.room` footprint inside its floor's outline, every pane in `windows` on an outside face. That turns "rooms fit the model" from a per-building script into one check, and tells us which buildings already fail it.

## Phase 3: rooms from the plan (design)

**Status: started 2026-11-25.** The generator runs on plans written by hand. It writes straight into content/ and the review is the git diff: commit what you like, and `--undo` puts back the rest. It hasn't been run on the real content/ yet.

**Built so far.** `client/shared/building-plan.js` reads a plan and lays the rooms out: the floors, the core, the chain of landing and halls (`depth` or `across`), tenement and mansion flats, and the ground floor's lobby, shop and back room. `client/shared/room-kits.js` holds the kits and the default bracket. `scripts/content/plan-rooms.mjs <plan>` writes the maps, zones, connections and furniture into content/ and checks them the way the Building Stage will draw them: it builds the building's graph and plan from its own files and fails if any room lands more than 5 cm from where the plan put it. Plans for the Yards Tenement and Corbett Mansions are in `scripts/content/plans/`; the Yards' sizes come from `yards-fit.mjs`, Corbett's are estimates until phase 2 records them. Both pass on twelve seeds each, and so does a four-storey test with real flights. With no flag it's for a building with no rooms, and refuses one that has them. `--replace` writes over a building's rooms: a file with the same id keeps its name, prose and the flags the generator doesn't own, a door between the same two rooms keeps its file, and a room with furniture a person placed gets no kit. It deletes nothing: what's left over (rooms, doors, generated furniture, and the people living or working in those rooms) is listed and written to `left-over.txt` for a person to set aside or delete, and the content won't import cleanly until they have. `--dry` writes nothing to content/. `--undo` puts back what the last run wrote, from a manifest in the run folder (plan-out/ in the system temp folder): it deletes the files it added and restores the ones it changed, and leaves alone any edited since, since `git checkout -- <file>` would also throw away a peer's unstaged work. It never imports or commits, and refuses if the Stage's check fails. Rooms sit on even grid cells only, since the pipeline joins two zones a cell apart whether or not there's a door. On a copy of content/, `--replace` on the Yards changed 24 files, added 29 and listed 360 left over (49 rooms, 94 doors, 106 pieces, 77 people, 34 residences); a write of a new building gave no stray grid joins, no one-way doors and exits that match every door. A third layout, `rooming`, lays single rooms off the landing and halls with a shared bathroom beside the landing on each floor. A plan's `finish` dresses every room it lays out (`worn`, in room-kits.js `finishFor`: timber panelling to the dado, faded paint, damp, peeling paper, a runner on the landings, tiled bathrooms, a payphone and a rent board in the hall), and never overrides decor a person set on a kept room. A plan's `ids` maps a generated room onto an id the building has (`lobby` to `hall`), so a replace keeps that room's file, its door and its tenants. A flat's existing door follows its connection when its rooms change. Run for real on 2026-11-25, uncommitted: the Yards Tenement (66 files, its left-overs not yet dealt with) and Rest Assured, moved from the holding map to 917,904 for the Yards' people (`scripts/content/rest-assured-east.mjs`; [stored-buildings.md](stored-buildings.md)), which lints clean. Its plan was measured from building-shapes.js and skyline-scale.js at its new tile, the way phase 2 will. A building that moves tile needs `scripts/snapshot-flight-world.mjs` and `npm run lite:bake` after `content:import`, or GLASS Lite draws its old ground. A plan's `floors: 'all'` gives every storey rooms, for a building people live in: the Yards takes it, 37 flats on ten floors with a real flight between each, where the sampled four floors gave 13 flats for 77 people. `scripts/content/yards-rehouse.mjs` then moved, household together, the 27 people the refit left without a home into free Yards flats and Rest Assured, and four wage-earners out of the Solenne to Chrome Court, which is kept for the well-off and the well-known. Not built: offices and hotels, lift cars (the landings say so in prose) and roofs. A climb past skipped storeys has no flight: the rooms line up over each other and the move is told.

What building it found that the design below didn't say:

- **One door a direction.** building-graph takes one exit a direction, so a landing has at most one flat on each side. The chain of landing and halls is how a floor gets more than four flats.
- **No room under 2 m.** The Stage widens anything narrower and moves it off the plan, so a mansion flat needs 5.4 m from the chain to its face for a bath beside its bedroom; narrower, it's a one-room flat.
- **Floors.** Every third or fourth storey down from the top, then each setback mass with none gets its lowest storey, and a stepped storey next to that one goes. Corbett comes out 0, 3, 8 and 11 on its own seed: three landings, as it has now.
- **Shared side walls force `across`.** Corbett's neighbours north and south would leave side flats without a window, so its chain runs along the front and its flats look east and west, as the hand layout's A and B do.

The generator is a script, `scripts/content/plan-rooms.mjs <building>`, that reads one building's plan and writes the content files for its rooms. It's the per-building fit script made general: what `yards-fit.mjs` and `embassy-hotel-rooms.mjs` read off a model by hand, it reads off the plan.

### What the generator needs beyond phase 2

Phase 2 gives floors, bays, the street door and shared walls. The generator needs five more things, recorded the same way (affine triples, at the canonical facing, turned afterwards):

- **Which floors are walkable.** A ten-storey tower doesn't need ten storeys of rooms. Corbett Mansions is twelve storeys with landings on 4, 8 and 12 only, so the inside climbs the height the street sees without 24 flats nobody visits. The plan marks every storey; the generator picks a sample (see "Floors").
- **Setbacks per floor.** The Yards' shaft is 14.3 m square to 27.6 m, then 11.8 m above. A floor's outline is the union of the masses that cross its storey line, not the footprint, so the top floors come out smaller on their own.
- **Ground-floor use.** The arm already knows when it draws a shopfront (the street kit's glazed front and awning at the Yards, the shop off Corbett's lobby). `PLAN_SINK` records a shopfront's bays as `retail`, so the generator puts a shop behind them and the lobby beside it.
- **Roof features.** A lift housing on the roof (the Yards) says the building has a lift; a water tank or plant room is a roof room, `open_sky`. No housing, no lift.
- **A core hint (optional).** The arm may call `markCore(x, z, w, d)` the way it calls `markDoorway`. Most won't; see question 2.

### The core

The core is the stair, the lift if the roof says there is one, and the landing each floor opens onto. It's placed once and goes straight up through every walkable floor, so the stair openings (`flags.room.stair` on the room below, [building-stage.md](building-stage.md)) line up by construction.

1. If the arm marked a core, use it.
2. Otherwise put it against the middle of the plan's longest shared wall, or of the back face if there's none. A core on a shared wall wastes no window, which is why Subversion's cores sit inside.
3. Size: a stair of `STAIR` width plus a 1.5 m landing, plus 1.6 m for a lift. Below about 9 m of frontage the stair runs along the wall as one flight a storey rather than a dog-leg.
4. The core must fit inside the smallest walkable floor's outline. If a setback cuts it off, move it inward until it fits every floor. If nothing fits, the generator stops and says so; that's a building to fit by hand.

The landing is the core's floor area outside the stair and lift: the zone every flat's door opens off, as `zone_yards_tenement_f3` is now.

### Floors

Every storey is in the plan; only some get rooms. The rule:

- Up to four storeys: all of them.
- Five to twelve: the ground, then every third or fourth storey, chosen so the top walkable floor is the top storey (Corbett's 4, 8, 12). The lift and the stair skip the storeys between, as they do today.
- Over twelve: the same, capped at four landings above the lobby.
- A setback always gets a walkable floor, since it's the floor that looks different from the street.

Room heights come from the storey lines, so phase 2's gate passes them by construction.

### Dividing a floor

With the core out, what's left of a floor is a ring or a U of floor between the core and the outside faces. The generator cuts it into units, then each unit into rooms. Both cuts are a split grammar in CGA's sense: a short list of rules per `building_type`, applied to the strip between the core and each outside face.

| `building_type` | unit | rooms in a unit | rules |
|---|---|---|---|
| tenement, apartment | flat | one room, or a room and a bath | flats along the outside faces, each at least 2 bays wide; a corner is one flat with two faces |
| mansion block, midrise | flat | living room, bedroom, bath | a flat runs from landing to facade; the bath goes on the core side with no window |
| office | suite | open floor and a meeting room | one suite a floor under 300 m², else two split at the core |
| shop with flats | shop on the ground, flats above | shop, back room; flats as above | the shop takes the `retail` bays and the depth behind them; the back room and the stair up share the back wall |
| hotel | room | room and bath | a corridor off the landing, rooms both sides |

Every cut lands on a bay line, so a wall between two flats never crosses a window. A room with an outside face gets that face's panes in `windows` from the plan's glazed bays; a room with none (a bath, a back room) gets none.

### Variation

- **Inside a building, floors repeat.** Real blocks stack the same flat, and a resident expects 3.1 to be over 2.1. The variation inside one building is what the model forces: a setback makes the upper floors smaller with fewer flats, and a corner flat differs from the rest.
- **Between buildings, the seed picks.** Each rule has two or three choices (one corner flat or two meeting at the corner; the bath at the core or at the end; the flat's door central or to one side; which way the landing turns), and the tile's seed picks, as it picks the building's height. Two tenements on two tiles come out differently, and the same tile always comes out the same, so a re-run is stable.
- **Furniture carries most of it.** What's in a room is noticed far more than its shape; see "Furnishing".

If a street of generated tenements still reads as one, the next lever is a per-building `plan_style` key with a few named variants, not more randomness.

### Furnishing: a starting kit per room

The generator can also write each room's starting furniture, so a generated building is a furnished foundation that people customise by hand or by one-shot, never an empty shell.

- **Each room has a role.** The floor cuts already say what a room is for: a flat's living room, bedroom or bath, a shop floor, a back room, a landing, an office suite, a hotel room.
- **Each role has a kit.** One table, `client/shared/room-kits.js`, lists the pieces a role expects: a bed and a wardrobe in a bedroom; a sink, a hob and a fridge where a flat cooks; a toilet, a basin and a shower in a bath; a counter flagged `serves` and shelving with the trade's `look.stock` in a shop; desks and a reception desk in an office; little or nothing on a landing. Corbett's flats are already furnished to this kind of list, by hand.
- **A wealth bracket changes the kit.** `flags.bracket` on the facade (`poor`, `middle`, `rich`) picks the version of each piece (a mattress on the floor, a bed, a four-poster), how much else is in the room, the finish (concrete or woodblock, the tones), and the placeholder `rent_cost`. It defaults from where the building stands, the street condition band, the slum district, Halcyon Fields as rich, and is set by hand where the default is wrong: a doss-house can stand in a good street.
- **The seed places it.** Pieces go against walls the room has, never in a doorway or across a window, by the Stage's own placement rules (`placeSpot` in room-layout.js). The tile's seed picks which wall gets the bed, so two flats with one kit don't look alike.
- **It writes content.** The pieces go into the room's file like any authored piece, each with `gen: true`. A re-run with `--replace` replaces only pieces carrying `gen`; anything placed by hand, or edited (the edit drops `gen`), is kept and listed if its room goes.

Kits stay short. Variety comes from bracket and seed, not from long lists, which keeps to the item slim-down: fewer items, customised.

The order for a building is: generate the rooms, furnish them, then move people in. Regenerating after people live there means moving them by hand.

### What it writes

For a building `<slug>`, under `content/`:

- **`maps/map_int_<slug>.json`**, if the building has none: `parent_zone_id` the facade tile, `entry_zone_id` the lobby or the shop.
- **`zones/zone_<slug>_*.json`**: the lobby, each landing (`_f<n>`), each unit (`_u<n>_<k>`), each room inside a unit, the roof, and a utility room under the lobby. Each carries `flags.room` with `w`, `d`, `h`, `at`, `face`, `floor`, its doorways and its `windows`, and the landing below each walkable floor carries a `stair`. Exits are the compass directions the geometry gives, so building-graph reads every door as `straight`. Flats get `is_apartment` and a placeholder `rent_cost` stepped by floor, as Corbett's are.
- **`connections/conn_<slug>_*.json`**: one per door, one per stair, and the front door to the facade tile in the direction of `flags.entrance`, never `out`.
- **A report**, printed, not written: each floor's outline and units as ASCII, where the core went and why, and every choice the seed made, so a reviewer reads one screen instead of fifty JSON files.

It writes no names beyond the ids and a plain default (`Flat 3.1`, `Landing, third floor`), and no prose, NPCs, `npc_residences`, lights or `power_zones`, and no furniture beyond the starting kit above. Those stay authored, with the lighting one-shot run in the same build.

**How it fits CODEX.** The files are ordinary content files. Whoever runs the generator reads the diff, edits what reads wrong, runs `content:lint` and `content:import`, and pushes; CI imports them like any other. Neither CI nor the server ever runs it. On a building that already has rooms it refuses, unless given `--replace`, which writes the new files and prints a list of the old ones that would go, for a person to set aside or delete, the way `yards-fit.mjs` put floor 10 on the holding map.

Refitting after a model edit is then a choice: phase 2's gate says a building no longer fits, and somebody either runs the generator with `--replace` or fixes the rooms by hand. A generated building that's been hand-edited since is just content; the generator keeps no state about it.

### Two buildings by hand

**The Yards Tenement (922,902).** Ten storeys of 3.6 m: a 14.3 m square shaft to 27.6 m (storeys 1 to 7) and an 11.8 m square top above (8 to 10), a lift housing on the roof, a glazed shopfront under an awning at street level, the door south.

*Today:* a lobby, a utility room under it, nine landings (f1 to f9; f10 is set aside), six one-room flats off each (north, east, south, west, northeast, northwest) with no `flags.room`, so each is `roomSpecOf`'s default flat. Nothing is behind the shopfront. Every floor has the same six flats, including the three in the narrower top.

*Generated:* it shares no wall, so the core goes on the back (north) face, about 3.5 m deep with the lift. Ground floor: a shop behind the shopfront's bays, the lobby beside it with the street door, the utility room below. Walkable floors: ground, 3, 6, 7 (the top of the shaft), 8 (the setback) and 10. On the shaft floors the strip round the core takes four flats: two on the south face and one on each side face running back to the core, each two or three bays. On the top floors, three. About 20 flats where today there are 54, which is the honest count for this building seen at six floors. Its residents and their `npc_residences` don't move by themselves: `--replace` lists every flat that goes, and people are moved by hand, as `yards-fit.mjs` moved floor 10's.

**Corbett Mansions (917,906).** Twelve storeys of red brick on a two-storey stone plinth, stepped back twice, a bay of windows up the front, a water tank on the roof, a shop off the lobby, facing east onto Lever Lane.

*Today:* the lobby with the shop to the south and a utility room below; landings on 4, 8 and 12; flats A (west) and B (east) on each, each with a bath to the north; a roof. Laid out by hand, and it already samples floors.

*Generated:* the shop takes the plinth's `retail` bays. The core goes on the north wall, shared with the next plot, and the baths go beside it without windows, which is where they are now. Walkable floors: ground, the top of the plinth, each setback, and 12; with two setbacks that's about the four it has, but on the setback floors rather than 4 and 8. Flats: A and B as now, one on each long face, a living room on the facade and a bedroom and bath behind; the bay window falls to whichever flat's face it's on.

The two say what the generator is for. It changes the Yards a lot, because those rooms were never fitted to its shape, and barely changes Corbett, because those were. Where Corbett differs (which floors are landings), the model is the better authority. The most it saves is on buildings with no rooms at all: the sealed Hughson towers and most of the infill.

### The open questions

1. **How much variation.** Repeat inside a building; vary between buildings by seed, among two or three choices per rule; let furniture carry the rest. See "Variation".
2. **Who places the core.** The generator, by default: the longest shared wall or the back face, fitted to the smallest walkable floor. The arm marks it with `markCore` only where the model draws it: a stair tower up the east end (Kestrel Court), an off-centre lift housing, a glazed stair. Where the model shows the core, the model decides, or the rooms wouldn't fit the model.
3. **Lit boxes from the plan.** Yes, and it's the cheapest win here. The lit box at `INTERIOR_TUNE.mid` needs a floor's outline, its height and its tones; the plan has the first two for every building, rooms or not, and `building_type` can give the tones. A building with no rooms could show a lit floor and ceiling behind its windows instead of a flat pane. It never stands in for a room that exists: a floor with rooms draws their boxes. This can be built straight after phase 2, before the generator.

### What could go wrong

- **Residents in rooms that go.** Regenerating a lived-in building removes flats people rent and NPCs sleep in. `--replace` never deletes; it lists, and moving people stays by hand.
- **A core that doesn't fit** a building with a thin setback. The generator stops rather than squeezing; those are fitted by hand.
- **Ids that shift.** Ids come from floor number and the unit's place along the face from the door, so the same plan gives the same ids, but a model edit that adds a bay can renumber. The report says which.
- **Templates.** If generated buildings read alike, add named `plan_style` variants before adding randomness.

## Risks

- **A query that runs the capture on a real frame** would cost far more than it saves. The arm must only read a cached capture.
- **Arms drawing by hand** skip the helpers and won't be covered. The phase 1 census lists them.
- **Plans that differ by facing.** Captures are taken at the canonical entrance; the plan must be too, then turned, or the four facings disagree (see "The `yaw` trap" in building-shapes.md).
