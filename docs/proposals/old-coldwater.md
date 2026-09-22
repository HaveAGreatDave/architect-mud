# Old Coldwater — the slums in the south-east corner

**Status: BUILT.** The ground, the district, the five buildings and their interiors, the six
GLASS arms, the tent mark and the five map icons all ship. What is deliberately absent is listed
under *What this deliberately does not do*.

Coldwater has 119 enterable facades and not one of them is poor. The cheapest bed in the city is
a room at Board Stiff, the cheapest meal is a plate at Loafing Around, and both of them take
credits at a counter from a person standing upright. The city has a casino, a bathhouse, two
banks and a vet. It has nowhere for somebody with nothing.

This builds that, in the one part of the map where it is already true: the angle in the
south-east where the south Curtain meets the east Curtain, which is the oldest ground in
Coldwater and currently 29 tiles of blank grass.

## The rule this follows

**Expansion, not infill.** [coldwater-infill.md](coldwater-infill.md) deliberately stopped at the
edge of the built grid, and named the reason: the strongest remaining candidates want a plot the
city does not have. This is that plot. Unlike the fourteen, it lays new streets, paints a new
district and grows the walkable map, and every one of those is a thing the infill batch refused
to do on purpose.

**The streets come first, because there are none.** `scripts/content/sitecheck.mjs` passes a tile
only when it has a standable road neighbour to hang a door on. Of the 29 tiles in this block,
Kessler Street reaches six and the rest have no frontage at all — so before anything can be
built here, the ground has to be given lanes. They are unpaved: the old town predates the grid
and was never surfaced.

**Old is not the same as ruined, and the district needs both.** Half of what is here is still
standing and still lived in. That is the half that carries the theme.

## The fiction

Coldwater started here. The power plant is the oldest thing in the city that still works, and
this is the oldest thing in the city that people still sleep in: a dozen timber-and-brick houses
put up before anybody drew a grid, on lanes that wander because they were cart tracks first.

Then the Architect dropped the Curtain, and it came down through the middle of it.

The south wall runs along y919 and the east wall runs up x927, and they meet at the corner of
what used to be Ropewalk. The other half of the street is still out there. You can see it from
the dead end: roofs, a chimney, a gable with the render off it, forty feet away and on the wrong
side of a sheet of hard light that has never once flickered. Nobody who lives here talks about
it, and the reason they don't is not grief. It is that it has been eleven years and the view is
just the view now.

That is [story.md](../story.md)'s theme 2 and theme 4 in one image. The oldest houses in
Coldwater are still standing, still occupied, and slowly killing the people who are proud of
living in them. The Curtain is theme 5 standing in somebody's back yard.

**The Pitch is the other half.** Everyone the Curtain cut off, everyone who came through the
South Gate and got no further, and everyone the rents pushed out of Nine Elms lives in canvas on
the flat ground behind the houses. It is not a refugee camp. It has been there long enough to
have lanes, a pecking order, and opinions about newcomers.

**Nobody calls it Old Coldwater except the map.** Locals call it the Shingles, and the joke is
old enough that nobody remembers it is one.

## The ground

29 tiles, x919–926 / y916–918, plus the Kessler tail at x924–926 / y914–915.

| Row | Tiles | What it is |
|---|---|---|
| y916 | 919–926 | **Ropewalk**, the spine. Unpaved. Enters from The Gate Road at 918,916 and off Glacier and Kessler from the north. Dead-ends at the Curtain at 926,916. |
| y917 | 919–926 | The north frontage: five enterable buildings, two ruins, and **Peg Lane** at 921,917 cutting south. |
| y918 | 920–926 | **The Pitch**, the tent ground, reached only through Peg Lane. 926,918 is the Curtain corner. |
| y914–915 | 924–926 | **Rag Row**, where Kessler Street gives out into unmade ground and the camp spills north along the inside of the east wall. |

**One way into the Pitch, on purpose.** Peg Lane is the only link between the frontage and the
tent ground, because a slum with four approaches is a park. It also makes the Pitch a place
where being followed matters.

⚠ **925,917 IS THE STORM DRAIN AND COULD NOT BE BUILT ON.** `zone_under_925_917` exits `up` into
that tile and the tile exits `down` into it, and it is the only seam into the Under anywhere in
the block. The first draft put a ruin there, which would have sealed the drain silently: nothing
in the content pipeline checks that a building is not being dropped on a z-layer seam, and the
only reason it was caught is that the ruin script printed nine sealed neighbour exits where two
ruins can only account for eight. It is **The Sink** now, a dead-end yard with a grating in it,
and the second ruin moved to 925,914 in Rag Row. It has no south exit, so Peg Lane is still the
only way into the Pitch.

⚠ **Mains Squeeze faces WEST, not north.** `place-building.mjs` prefers a neighbour whose terrain
is literally `road`, and 918,917 is The Gate Road while Ropewalk is `dirt_road`. That is the
better frontage anyway and it was left alone: the water seller now faces the traffic walking up
from the South Gate, which is who buys water.

### The buildings

| Tile | Name | `building_type` | Door | Keeper |
|---|---|---|---|---|
| 919,917 | **Mains Squeeze** | `water_seller` | **west** | Bartram Quell |
| 920,917 | *A Collapsed Terrace* | `ruin` | — | — |
| 922,917 | **Bed Rock** | `flophouse` | north | Wilmot Scarrow |
| 923,917 | **No Such Thing** | `soup_kitchen` | north | Hestia Dunmore |
| 924,917 | **A Stitch In Time** | `bonesetter` | north | Merrit Lachance |
| 925,917 | **The Sink** — *not a building* | — | — | — |
| 926,917 | **Still Standing** | `shebeen` | north | Thomasina Tillery |

**Mains Squeeze** sells water, because the Curtain cut the mains along with everything else and
the standpipe has been dry since. A riveted tank on a timber trestle over a one-room hut, with a
queue rail bolted to the front and a chained tin cup nobody has stolen. The silhouette is a tank
on legs, which the city has nowhere else. He is scrupulously fair about the price and will tell
you, unprompted, exactly what it costs him.

**Bed Rock** is the doss house: the oldest building in Coldwater, four storeys of timber frame
with an external stair bolted on and a ridge that has visibly given. Beds by the night. The
name is what the beds feel like and what the building is standing on, and he did not intend
either.

**No Such Thing** feeds people for nothing. A long low hall with a chimney at one end and a
canopy over the queue, and a painted board across the front that says NO SUCH THING and nothing
else, because everybody already knows the rest of it. She has run it for nineteen years and gets
extremely short with anyone who calls it charity.

**A Stitch In Time** sets bones and closes wounds and does not ask where you got them. One room,
a lit window, a bench under a lean-to for the queue. The distinction from Co-Pay & Pray is not
skill, it is paperwork.

**Still Standing** is the shebeen: a plank counter open to the lane under a tarpaulin, with the
still in the back room and no licence anywhere. Both meanings of the name are true and one of
them is getting less true every year.

### What is not a building

**The tents are not buildings**, and that is a structural decision rather than a cosmetic one. A
building tile is removed from the walk graph and enters the CFIT collision sweep, so a tent city
built out of `building_type` would be a tent city you cannot walk into and can crash an aircraft
on. The camp is a `mark` on standable ground, the seam the statue, the South Gate, the road
signs and the depot shed already use ([state.js](../../plugins/flight/state.js), `deriveSurfaceCell`),
so the Pitch renders as canvas from the air and is ordinary walkable dirt on foot.

**The ruins are buildings**, for the mirror-image reason: a collapsed house is exactly the thing
you cannot walk through.

## What has to be built in the renderer

| Piece | Where | Why it is new |
|---|---|---|
| 5 `drawTypeModel` arms | windshield.js | Every one is a silhouette Coldwater has never drawn: a tank on a trestle, a timber frame with an external stair, a long hall with a queue canopy, a lean-to, an open counter under a tarp. |
| A real `ruin` arm | windshield.js | `drawRuin` exists and is two boxes with a Redline glow, reachable only as a biome archetype. It has never drawn a building. |
| A `camp` mark | state.js + windshield.js | Canvas peaks, guy lines, a smoking brazier. Nothing in GLASS is made of fabric. |
| 6 map icons | `client/game/assets/zone-icons/` | One per new `building_type`, registered in `derive.mjs`'s `BUILDING_TYPE_ICON` in the same build as the tile. Never backfilled. |

`shapes:smoke` refuses a building tile whose type has no arm, so the tiles and the arms are one
job and the suite already knows it.

## The district

`content/districts/slum.json` already exists, has **zero tiles**, and is claimed by nothing: the
Under uses neither the id nor the name. It is adopted here rather than adding a twenty-fourth
district. `id` stays `slum`, the display name becomes **Old Coldwater**, and the blurb,
signature, skyline and prefixes are rewritten for an open-air shanty instead of the covered
underside the original lines describe.

⚠ Its `prefixes` must be rewritten to the new street names (`ropewalk`, `peg`, `pitch`, `rag`),
or `districtFor` falls through to whatever the tile is called and the boundary line fires in the
wrong place.

## The second pass: the lanes, the camp and the paint

⚠ **THE LANES WERE `dirt_road` AND THAT DREW A PAVED JUNCTION AT EVERY TILE OF THE SLUM.**
`deriveAutoTile` joins two tiles when BOTH terrains carry `auto_tile`, and that set is exactly
`{road, dirt_road}` — deliberately, so a graded haul road like The Glacis meets a paved street at
a proper junction. Ropewalk is a cart track nobody surveyed. Measured against the real palette
before the fix: Ropewalk drew `road_new` on **five consecutive tiles** and a full `road_nesw`
crossroads at 921,916, with The Gate Road growing an arm east to meet it.

The lanes are `dirt` now and the camp ground is `ash`, both `auto_tile: false`, so no slum tile
draws a connector and the paved neighbours stopped reaching into it (The Gate Road went `road_nes`
→ `road_ns`). **The lane still reads as a lane, by contrast rather than by connector art** —
`#6b5138` worn brown against `#4f4b47` churned grey is a track through a camp. ⚠ Losing
`dirt_road`'s `speed_mult: 2` is correct rather than a cost: the Shingles is mud, and walking it
being slower than walking Kessler Street is the district working.

⚠ **The derive pass's own comment prescribes a different fix and it is out of date.** It says a
terrain that must not fuse with roads "would need a family key in the palette — inventing that
field before a second family exists is how the three drifted terrain tables happened". The field
exists (`auto_tile_family`, carried by the four cliff terrains) and a second family already
exists, so the stated precondition is met — but `deriveAutoTile` compares `auto_tile` and never
reads the family, so a third family is a real engine change plus sixteen new `path_*.svg` pieces.
Not auto-tiling at all is what a cart track wants anyway, and it needed no art and no engine.

### The camp

**It was six identical grey ridge tents and read as a campsite.** Several pitches, in three
shelter kinds — a ridge tent, a flat tarp on four posts with a sag in it, and a lean-to — drawn in
five weathered tarpaulin colours and patched with each other, because every sheet in a shanty has
been mended with whatever the last one was made of. Over them: poles taller than anything under
them, a cable strung between and on past both of them to the tile edge so a row of camp tiles
reads as one line rather than ten pairs of sticks, and a lamp hanging off the cable. A banner on
one tile in three, drums and crates on the mud, and a slogan hand-painted on one sheet in four.

⚠ **A LIT TENT IS A WARM TARP, NEVER A GLOW BESIDE A TENT.** A lamp under canvas lights the
canvas, from the inside, so it is a term on the surface colour rather than a sprite. Two reasons
it cannot be a sprite: `emitDecoFill` quads are depth-TESTED, so a glow at the tent's own centre
is hidden by the tent's own sheet (measured — it came out as a few pixels leaking round the edge),
and a pool on the ground beside a dark wedge reads as a lamp somebody left outside. The night
factor is lifted rather than cancelled, so a lit tent is still a night-time tent. What remains as
a sprite is the spill at the gable mouth, which is the only part of a tent a lamp can get out of.

⚠ **The first cut of the night camp was measured as unreadable and the numbers are worth keeping:**
the hanging lamp at `k: 5, alpha 0.26` and the brazier at `k: 9, alpha 0.30` produced a black band
with two orange dots in it. The lamps are 9/0.42 and 11/0.48 now, and the pole height varies per
tile so a row of camp tiles is a sawtooth rather than a fence rail.

### The paint

⚠ **IT IS WIRED AND NOBODY HAS SEEN IT LAND.** `TAG_DENSE` scales all four `sprayOn` gates by
`TAG_EASE` (0.26) for the six slum types — the same shape of knob as `KIT_DECLINE`, keyed the same
way on `tradeOf(m)`, scaling the gates rather than replacing them so the relative ration between a
street face and a back wall is preserved.

What is measured here is the PROBLEM, not the fix. Four seeds of Bed Rock at the eased gate showed
**zero** pieces; the paint pass returns hard when `bareRuns` finds nowhere clean; and the Modelshop
preview could not settle it, because its texture caches warm on the first render of a type, so a
canvas-mint count answers for the cache rather than for the building. The slum also declines the
`wall` section, which is right on its own merits — a doss house has no glazing rhythm and every
opening these buildings have is one their own arm drew — and is **not** established as the thing
that makes the paint appear. Somebody should stand in front of one of these in the game before
this section is rewritten.

The camp's own graffiti is a separate path and does not go through the kit at all: one tile in
four paints a slogan on the biggest sheet facing the lane, through `bakeTagText` with the
`handstyle` hand (a marker scrawl, which is what somebody writes on canvas) rather than
`bakeSignText`, and through `emitSurfaceText`. Near tier only: below a certain size it is a smear,
and a smear where a sentence should be is worse than bare tarp.

## Shipping it

Content and the renderer both reach prod through an ordinary push ([content-pipeline.md](../content-pipeline.md)).

⚠ **One manual step afterwards, exactly as the infill batch needed:** `light_on` is an
export-excluded runtime column, so an additive deploy lands every new fixture OFF. After the
deploy run

```bash
node --env-file=.env.prod scripts/content/seed-runtime.mjs
```

once, or all sixteen new interior rooms (eleven habitable plus five utility) are scored as **open air**: lit by the sun and pitch
black at night.

## What this deliberately does not do

**No new mechanics.** The flophouse rents beds through the housing system that already ships, the
soup kitchen serves through cooking, the water seller fills through `fillable`, the bonesetter is
a `repairman`-shaped NPC against the existing injury and durability systems, and the shebeen
pours through mixology. Nothing here adds a verb.

**No gang, no quest line, no faction.** Old Coldwater is a place before it is a plot. What it is
worth is decided by standing in it.

**Nothing on the far side of the Curtain.** The cut half of Ropewalk is a view and stays a view.
Making it reachable is a different and much larger change to what the Curtain means.

---

## The gaslight pass (2026-09-21)

The quarter shipped with eleven interior rooms, eleven working overhead lights and a junction
box per building, all of it functioning perfectly. That is the one thing this district should
not be. `scripts/content/old-coldwater-gaslight.mjs` is the fix: **the shops are a roof and a
counter better off than the tents forty feet away, and not more than that.**

**The supply is fine and the boxes are not.** All five junction boxes carry `flags.faulted`
(new — see [flags-keys.md](../flags-keys.md#generatorsflags)), so every room in Old Coldwater
is unpowered with its light fittings still screwed to the joists. ⚠ **The fault is on the
building's side of the meter and must stay there.** Cutting these buildings off their city
plant would express "the grid does not reach this district", which is a far larger claim than
"nobody has answered the call-out", and it is not what is happening: the plant is carrying a
fifth of its capacity and the feed reaches the wall.

**Eleven gas lanterns**, at `light_type: 'gas'` — the new off-grid class documented in
[architecture.md](../architecture.md). A lit off-grid fixture raises `has_emergency_lighting`,
so every room reads at `EMERGENCY_LIGHT_LEVEL`: dim, and not dark, which is the register of
the whole place. ⚠ **The dead overheads all stay.** Nothing here has been taken out; it has
just stopped, and a fitting with a bulb in it that nobody alive in the building has switched
on says that better than an empty ceiling.

⚠ **The lantern list is checked against the rooms, not counted.** The script derives the set of
interior rooms from the five buildings and refuses to run if any of them is missing a light.
The first draft missed The Front Desk, which would have shipped as one pitch-black room you
could only find by walking into it.

**Camping stoves and butane.** Four stoves where people actually live — the flophouse dorm
(one per bunk that can afford one; the house stove is for heat, these are for eating) and three
camp pitches — plus `item_butane_canister`, which turns up part-used in `scav_consumer_trash`
and `scav_roadside_junk`, because that is where everybody in the quarter gets theirs.

**How the quarter earns**, in three sentences across Peg Lane's mouth, the East Wall and
Ropewalk: begging at the Gate Road and in the soup-kitchen queue, and going out through the
Gate after something with a bounty on its parts. ⚠ **Written without a verdict.**
[lore-wildblood.md](../lore-wildblood.md) is explicit that the Watch calls it cannibalism, the
Wildblood call it inheritance, and the game takes no side. These are people who need the money
or the meat; no line here is admiring or disgusted, and `item_raw_meat` and `item_mutant_gland`
already existed, so the two halves of "for meat or a profit" needed no new content at all.

**Still deliberately absent:** no verb, no quest and no repair path for the boxes. Somebody
fixing Old Coldwater's wiring is a thing the district should have to be *given*, not something
a player can buy their way out of on the second visit.

---

## The dereliction pass (2026-09-22)

The quarter had the right parts and read too tidy from a cab: one ruin silhouette, a fixed five
pitches on every camp tile, and three slogans across the whole district. Four changes, no new
mechanics and no new content types.

**The ruin is a house with half of it gone.** The old arm was a front wall, a knee-high remnant, a
stack and a rubble wall — a low broken rectangle with one finger out of it, which reads as an
*unfinished shed* as readily as a collapse. What was missing is that a terrace does not come down
level. It is two halves now: one still standing under its own roof, one no higher than the first
floor with no lid at all, and ⚠ **that single roof-flag asymmetry is the whole read** — a ruin with
no lid anywhere is a compound and a ruin with a lid everywhere is a shed. On top of the open half,
three **teeth** at three heights turn a level top edge into a break line; across it, six **joists**
say this was a house rather than a yard. Openings on the standing half are **boarded** — a pale
timber panel with two planks nailed across it at an angle nobody measured — with one left as a
black void, because the tile wants both: the first is a house somebody still owns and the second is
a hole in a wall.

⚠ **The paint is applied in the arm and not left to the derived kit.** `TAG_DENSE` already eases
this trade's gates and the section above records that nobody had ever seen a piece land on one of
these walls. The reason is structural rather than a tuning miss: the kit needs a bare RUN at its
paint band, and this frontage is two short boxes with openings in them rather than the long clear
flank `bareRuns` searches for. Five pieces now, across both halves, each with a hand rolled off the
same number its word comes from — which is the kit's own rule, because a fresh roll for the hand
shifts the stream and moves the word with it.

**More tents, and a density that varies.** The pitch count was five on every tile, and one density
over ten tiles reads as a layout — a campsite with numbered pitches rather than ground people keep
arriving on. It is six to eleven rolled per tile, which puts a crowded tile beside a thin one and is
what makes the thin one read as thin. ⚠ **Near tier gets the whole roll and the cheap tier is capped
at seven**: past that the shelters are a few pixels each and overlap into one dark mass, so the extra
ones cost a draw and subtract from the read. The cap is on the DRAWN count and never on the roll, so
a tile holds the same pitches at both tiers and simply stops early. Clutter is rolled the same way.

**Three more camp tiles, two of which the prose had already put tents on.** 924,915 (Rag Row) opens
*"A row of pitches down one side"* and 927,917 (The East Wall) says *"Tents are pitched hard against
it the whole length of the corner"* — and neither carried `flags.camp`, so both described a camp the
cockpit could not see. 927,918 (The Corner) joins them. ⚠ **927,916 deliberately does not**: the Cut
is the one tile whose whole job is the view through the Curtain, and this doc's own rule is that the
far side stays a view.

**The camp writes more on itself, in three registers.** Three slogans became eighteen, and the list
is deliberately not one voice: a **territory** line is addressed outward at the city, a **notice** is
addressed at the lane and is the only kind with a practical purpose, and a **name** is addressed at
one person who may not be coming. The third does the work — a camp that only ever shouts is a
protest, and a camp with somebody's name on a tarp is people living somewhere. It lands on two tiles
in three rather than one in four, and one tile in three of those carries a second line lower down in
a different ink, ⚠ **taken from a different part of the list rather than re-rolled freely**, because
two territory lines on one sheet is a placard.

Nothing here is a joke and nothing here is a verdict.
