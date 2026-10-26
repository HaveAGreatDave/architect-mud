# Halcyon Fields, the third campaign — the quarter gets streets

**Status: BUILT.** The five new streets, the garden square, forty-two buildings, eight GLASS arms,
eight map icons and the restyle of the quarter's thirteen remaining masonry-shaped arms all ship.
Thirty-one of the forty-two are enterable; the eleven that are not are the plots with cranes on
them (§2, §2b). What is deliberately absent is listed under *What this deliberately does not do*.
Every building here was renamed on 2026-10-08 to its street address or a plain Halcyon name, and
this page uses the new names throughout; the old ones and the reason are in
[*The fifth pass*](#the-fifth-pass-addresses-not-puns-2026-10-08).

Six of these buildings and Vetch Green are no longer on the map. On 2026-10-18 the Charles B.
Hughson Coliseum, Deadball's ballpark, took the nine tiles x 895 to 897, y 911 to 913: 8 Halcyon
Boulevard, the Halcyon Institute, the Halcyon Land Office, 3, 5 and 7 Sorrel Way and the green
between them. They're set aside on the holding map `map_set_aside`, whole, not deleted; see
[hughson-coliseum.md](hughson-coliseum.md#3-what-was-set-aside).

Halcyon Fields is 164 tiles. Before this, 27 of them were buildings, 24 were road, and a hundred
were meadow with a tower standing in it. Four streets ran through it — Halcyon Boulevard along the
top, Kerbstone Row across the middle, Kettle Lane and Cinder Lane down through it — and the biggest
block they left was seven tiles by five with no way into the middle of it at all.

It is 69 buildings, 64 road and a 3-tile garden square now, and the only open ground left is the
verge inside the Curtain.

## The rule this follows

**[old-coldwater.md](old-coldwater.md)'s rule, in a quarter that already had some.** Streets first,
because `scripts/content/sitecheck.mjs` passes a tile only when it has a standable road neighbour
to hang a door on, and the interior of a five-by-seven superblock has none. The difference from Old
Coldwater is that the district, the palette, the signage and the material argument were all already
here: this is infill inside a quarter that exists, not a new one.

**[coldwater-infill.md](coldwater-infill.md)'s selection test, applied to silhouettes rather than
trades.** That batch refused a building whose model would be the shop box in a new colour. The same
test here is the palette block's own rule, which is worth quoting because it IS the brief:

> The palette is deliberately narrow — four values of chrome and two of glass, reused across
> fifteen buildings — because an estate built in one campaign by one developer looks like one
> thing… **The variety is in the SILHOUETTES**, which is where variety survives fog.

So the eight new types add **no new colours at all**. They add a twist, a bulge, a step, a point, a
courtyard, a lens, an arch and a building that is visibly unfinished.

## 1. The ground

| Street | Tiles | What it does |
|---|---|---|
| **Vetch Mews** | x893, y912–915 | North off Kerbstone Row into the big block, dead-ending at the back of Coldwater Recital Hall. |
| **Sorrel Way** | y914, x894–898 | The through street: mews to Kettle Lane. The first road in the quarter with buildings on both sides. |
| **Cowslip Rise** | x905, y911–915 | North off Kerbstone Row into the east block, dead-ending at the back of The Dead Pigeon. |
| **Windrow Lane** | y918, x892–910 | The perimeter service road inside the Curtain, behind the Kerbstone Row frontage. |
| **Vetch Green** | 895–897, y912 | Not a street — the three tiles no street can reach. |

⚠ **ONLY TWO TILES ON KERBSTONE ROW CAN CARRY A ROAD NORTH INTO THE BIG BLOCK**, and that decided
the whole plan. The block's north edge (y911) is a solid frontage onto the boulevard, its west edge
is the Curtain, and five of the seven Kerbstone Row tiles facing it are already built on — Light
Relief, Halcyon Pavilion, The Winter Garden, 15 Kerbstone Row, and 5 Kettle Lane one row in. x893 and x898 are
what is left. The mews goes up x893 and x898 stays a plot, because a second parallel mews four
tiles away serves nothing a through street does not.

⚠ **SORREL WAY RUNS ALONG y914 RATHER THAN y913 SO THAT IT IS A STREET AND NOT A SPUR.** Second
Wind stands at 898,913, so a road on that row dead-ends against its flank; one row south the same
road reaches Kettle Lane and the block gets a route through it.

⚠ **VETCH GREEN IS THREE TILES NO STREET CAN REACH, AND THAT IS WHY IT IS A GREEN.** 895–897,912
are enclosed on all four sides by frontage — the boulevard row above, Sorrel Way's plots below, and
the mews too far west to help. A building there would have no door. A garden square behind a
boulevard frontage is what that shape of land is actually for, and the quarter gains somewhere to
sit that nobody is selling.

⚠ **THERE IS STILL NO ROAD ALONG y919**, for batch0's reason: `curtainSegs` builds the Curtain's
arms from the TILE CENTRE, so a road on the wall's own row is a road with a wall down the middle of
every tile of it. Windrow Lane runs one row in and y919 stays verge.

## 2. The buildings

**Forty-two plots.** Thirty-one are enterable and eleven are not, and the eleven are the building
sites.

⚠ **THIS SECTION SAID TWELVE AND THIRTY UNTIL batch9, AND THE REASONING IT GAVE WAS HALF RIGHT.**
The argument below — that thirty invented lobbies would be thirty corridors with a lift in them —
holds for a plot with a crane tied into it at three levels and does not hold for a building the
same file calls "clad, topped out and let". A finished building on a made-up street with no way
into it is not restraint; it is a facade in the theatrical sense, and a player walking Kerbstone
Row met six of them in a row. batch9 gave the nineteen a door each. The eleven shells keep theirs
shut, which is what the argument was actually about.

### The twelve you can walk into

Every one of them is an ESTATE programme — not one is a trade that could equally have gone in the
Filaments. What a half-built quarter has that a finished one does not is the machinery of selling
itself, and that is the thing worth building while it is still true.

| Tile | Name | Type | Programme |
|---|---|---|---|
| 894,913 | **Halcyon Sales Suite** | `atrium_court` | The marketing suite, and the model of the quarter under a dust case |
| 895,913 | **3 Sorrel Way** | `lens_hall` | Art held on deposit, hung because hanging is cheaper than crating |
| 892,913 | **5 Vetch Mews** | `bead_tower` | Serviced apartments; eleven let, four lived in |
| 906,915 | **Halcyon Arch** | `chrome_arch` | The landmark, and a free public room in the top of it |
| 901,911 | **1 Cinder Lane** | `torque_tower` | A deposit house: no lending, no interest, no insurance |
| 897,913 | **7 Sorrel Way** | `cascade_block` | The health club, with the pool on the top terrace |
| 903,911 | **2 Cinder Lane** | `glass_prism` | A viewing spire with a turnstile nobody has ever collected from |
| 901,915 | **Halcyon Estate Office** | `atrium_court` | The estate office, and the amber tacks on its plan |
| 900,915 | **10 Kettle Lane** | `chrome_slab` | The bar, trading on one highlighted clause of somebody's lease |
| 896,913 | **5 Sorrel Way** | `atrium_court` | The café on the green |
| 904,917 | **Halcyon Site Office** | `cascade_block` | The site office, and the quarter's builders' merchant |
| 898,915 | **17 Kerbstone Row** | `torque_tower` | Fourteen tables at the top of a tower that has turned a quarter round |

Four carry a keeper: Lavinia Fairlie (the sales suite), Berenike Ostrow (the concierge), Ellery
Pardoe (the estate office) and Nadia Ferreira (the café).

### The eleven with no door

⚠ **WHY ELEVEN BUILDINGS WITH NO WAY IN, IN A CITY WHERE 196 OF 196 FACADES ARE ENTERABLE.**
Because they are building sites. Every one of them is a `shell_tower` with the crane still up, and
a site office you can walk into already exists a street away (Halcyon Site Office). The district blurb
has said what they are since batch0 — *"half-built frontage"*, *"behind the hoardings a generator
runs, and nothing it powers is finished"*.

The other nineteen were in this list until batch9 and should not have been: they are clad, topped
out and let, and the argument for keeping them shut was an argument about cranes applied to
buildings that do not have one. See **§2b**.

They carry `is_building` **without** `facade`, which is the ruin pattern from
`build-old-coldwater.mjs`: mass out the canopy, a footprint and a map code, and no revolving door.
They keep `entrance` and `floors`, which a ruin deliberately does not — both reach the flight cell
through `deriveSurfaceCell` (the model's facing and its height) and NEITHER reaches the engine,
because `buildingEntranceDir` and `isEnterableFacade` are both gated on `facade`. ⚠ And every
neighbour's exit into them goes with theirs, or you walk into a solid.

Converting one later is additive: author it through `authorBuilding` in a new batch and it
overwrites the tile, adds the `facade` tag and the interior map, and re-strips the neighbours.
⚠ And `batch8.mjs` now REFUSES a plot that has since been given a `facade`, because it would
otherwise strip the tag straight back off and re-seal every neighbour, orphaning an interior map
and the NPC standing in it — silently, since a building with no door is a legal world.

⚠ **THE ELEVEN SHELLS ARE THE ELEVEN AMBER TACKS** on Pardoe's plan in Halcyon Estate Office. He says the
number out loud, so a twelfth `shell_tower` makes his line wrong; `batch8.mjs` asserts the count.
It is also why batch9 refuses a shell outright rather than counting: the cheapest way to leave all
eleven alone is to make converting one an error.

### 2b. The nineteen that got a door (batch9)

Every one of them gets the full `authorBuilding` treatment — a facade with the entrance on the
side the GLASS model has been drawing its hood on since batch8, two or three rooms, a light in
every room, a utility room with a junction box, a generator and a `power_zones` row per room.
Eight carry a keeper.

| Tile | Name | What is inside | Keeper |
|---|---|---|---|
| 892,914 | **1 Sorrel Way** | Entrance hall and a post room with 120 boxes, four of them in use | Corvin Brask, porter |
| 894,912 | **8 Vetch Mews** | Hall, and the terrace whose balustrade film never came off | — |
| 895,915 | **4 Sorrel Way** | A storage counter and four racked bays in a drum sold as offices | Ottilia Fenwick |
| 900,911 | **2 Kettle Lane** | Lobby and the mezzanine the planning consent requires to be public | — |
| 900,914 | **8 Kettle Lane** | ⚠ **The apartment building** — letting office, landing, four flats | Marius Lindqvist |
| 901,912 | **3 Cinder Lane** | One hexagonal lobby in which no corner is a right angle | — |
| 903,912 | **4 Cinder Lane** | Podium lobby and the tenth-floor sky lobby from the brochure | — |
| 903,914 | **8 Cinder Lane** | The specification hall, and the comms room line eleven means | Ghalia Toussaint |
| 903,915 | **10 Cinder Lane** | The widest floor in the tower and the narrowest landing | — |
| 904,911 | **Halcyon Point** | Lobby, and the forty-foot apex volume that has never been let | — |
| 904,913 | **5 Cowslip Rise** | Front desk and a wall of 41 camera feeds, 11 of them dark | Hektor Vallance |
| 906,914 | **8 Cowslip Rise** | A through-hall with a street at each end, and the gravel terrace | — |
| 907,915 | **31 Kerbstone Row** | Podium lobby and a show home dressed rather than furnished | — |
| 892,917 | **2 Kerbstone Row** | Entrance hall and the corridor along the blind flank | — |
| 894,917 | **6 Kerbstone Row** | The public passage, a kiosk in it, and the room behind | Imelda Culhane |
| 896,917 | **10 Kerbstone Row** | Lobby, and the landing where the bright collar is exposed | — |
| 897,917 | **12 Kerbstone Row** | Shared lobby with four name plates, and the dance studio | Roshan Adeyemi |
| 901,917 | **20 Kerbstone Row** | A lit, heated, immaculate lobby with nothing in it at all | — |
| 902,917 | **Halcyon Records Office** | The undercroft everybody shelters in, and the records office | Elspeth Quillon |

⚠ **THE ENTRANCE DIRECTION WAS NOT A FREE CHOICE.** `flags.entrance` has been reaching
`deriveSurfaceCell` since batch8 ran, so it is the side the model has been drawing its hood,
canopy and lettering on all along. Moving a door to somewhere more convenient would put it on a
blank elevation and leave the drawn one on a wall you cannot open. All nineteen already faced a
road, and `authorBuilding` refuses a spec whose entrance neighbour is not `terrain: 'road'`.

⚠ **THE EXTERIOR PROSE IS batch8'S, RE-READ RATHER THAN REWRITTEN.** `outside()` pulls the
description off the tile that is already there and appends one sentence about the way in. What was
missing from those nineteen paragraphs was never the building, it was the door.

⚠ **8 KETTLE LANE IS THE APARTMENT BUILDING, AND batch8 HAD ALREADY MADE THE CASE FOR IT.** Its launch
terms were on a board by its own door and it was described as "a third occupied anyway", which is
exactly a building with flats going. Three of the four authored units are vacant and carry
`is_apartment` + `rent_cost: 200`, so RENT works standing in them with nothing else built; the
fourth is Lindqvist's, because a letting agent who does not live in the thing he is selling is a
letting agent nobody believes — and an NPC in a rentable unit is the intended shape rather than a
collision, since `npc_residences` tracks occupancy off `home_zone`.

⚠ **THREE THINGS IN `lib.mjs` WERE WRONG AND ONLY A SEALED PLOT COULD SHOW IT.**

- **The street's exit back at the door was never written.** The neighbour loop does two jobs that
  read as one — strip every door the author did not choose, grant the one they did — and it
  `continue`d on a tile with no existing link to the facade. Every plot until now came in off open
  ground, where a road tile always already points at its neighbour; batch8's plots arrive with
  every neighbour exit stripped on purpose. The symptom is a facade you can leave and cannot
  enter, and the only thing that reports it is `content:lint`, as *"zone_edges would invent an
  exit"*.
- **`utilityAnchor` in an upstairs room eats the stair home.** A room reached by `up` holds its way
  back on `down`, which is the slot `authorUtilityRoom` takes, and the utility room is written
  last. The existing guard looks for a room hung *below* the anchor and cannot see this, because
  the offending room is the anchor's own parent. Halcyon Records Office is why there is now a second guard.
- **Only the anchor gets a free light.** `anchorKey` falls back to the entry room, so for most
  buildings a `lights` map covering every other room is complete — set `utilityAnchor` and the free
  light moves with it, leaving the first room any player stands in with no fixture. Three of the
  nineteen shipped that way for one run. A building with one unlit room is a valid world; it just
  reads as open air indoors. It is a build failure now.

### The heights are a profile, not a roll

The estate was built north to south and the money ran with it, so the tall end is the boulevard end
(Halcyon Point at 20, 4 Cinder Lane at 19) and the last phase along the Curtain is six to twelve.
A skyline that steps says which way a quarter grew. A skyline of random heights says nothing at
all, and from a cockpit that is the only thing about it you can read.

## 3. The eight new silhouettes

All in [glass/models/halcyon-fields.js](../../client/game/js/panels/glass/models/halcyon-fields.js) (they were `case` arms in `drawTypeModelArm` in windshield.js until 2026-10-01), all on the existing palette.

| Type | The shape | Used |
|---|---|---|
| `torque_tower` | A stack of floor plates each turned a few degrees on the one below | 3 |
| `bead_tower` | Six glazed bulges threaded on a chrome spine, pinched to a collar between | 5 |
| `cascade_block` | Four masses of falling height, each further forward than the one behind | 5 |
| `glass_prism` | Six sides of tinted glass drawn to an actual point | 3 |
| `atrium_court` | Two curved wings round a glazed drum, wider than it is tall | 5 |
| `lens_hall` | A glazed disc on six chrome legs, thickest through the middle | 3 |
| `chrome_arch` | Two legs that lean together and meet, with the road under them | 1 |
| `shell_tower` | Clad as far as the money went, bare floor plates above, crane alongside | 11 |

Four things in there are worth knowing before touching any of them.

⚠ **A DRUM INSIDE THE TWIST IS WHAT MAKES IT WATERTIGHT.** Two boxes at different yaws share their
centre and nothing else, so between one lift's corner and the next one's flank there is a real
wedge of nothing and you can see daylight through the building. The core closes every one of those
gaps at every angle for one primitive — and it is the same drum a real one has the lifts in.

⚠ **`drawFacetDrum` IS A CONE, so a bulge is two of them back to back.** Written as one drum with a
fat middle, a bead tower is a barrel, and a barrel is what a silo looks like.

⚠ **THE ARCH'S LEGS STOP SHORT OF THE APEX AND THE KEY SWALLOWS THE REST.** A parabola is nearly
horizontal at its crown, so up there each lift steps sideways further than a leg is wide however
many lifts you use — a staircase of notches exactly where the eye goes. Below `T_MAX` the curve is
steep enough that a fat overlapping drum bridges its own step; above it, there is one box.

⚠ **HOW FAR A SHELL'S GLASS GOT IS SEEDED, AND THE CRANE FOLLOWS FROM IT.** A fixed fraction made
eleven identical machines over eleven identically half-clad towers, which reads as one building
repeated rather than as a site — and eleven bright yellow lattice masts is a great deal of noise in
a quarter whose whole palette argument is that it is narrow. A shell whose cladding has nearly
caught up has had its crane taken down, because that is the order the work happens in.
⚠ **THE PROSE HAD TO FOLLOW THE MODEL, NOT THE OTHER WAY ROUND.** Every shell's description names a
cladding floor and a crane state; `tileSeed` is `(wx + 512) * 73 + (wy + 512) * 149`, so both are
computable per tile, and six of the eleven descriptions were rewritten to match what the arm
actually draws. The alternative was keying an arm on a building's NAME, which is Architect leaking
into THOMAS.

## 4. The restyle

The quarter's thirteen remaining masonry-*shaped* arms went to chrome and glass: `concert_hall`,
`members_club`, `auction_house`, `institute`, `land_office`, `hydro`, `winter_garden`,
`pumping_station`, `cooling_plant`, `gasholder`, `substation`, `exchange`, `fire_station`.

⚠ **THE MATERIAL PASS HAD ALREADY HAPPENED AND THE COMMENTS WERE STALE.** `ty_going` was in
PLAIN_WALL and its arm still said "blind stock brick"; `ty_wires` was in GLASS_WALL and its arm
still said "BRICK_WALL, and four storeys of it". What was left was the GEOMETRY — every one of
these was still a box, because they were written before the quarter had a rounded vocabulary. The
comments are fixed with the shapes.

Three of them are corrections rather than restyles:

- ⚠ **The gasholder was already the round one and the arm was drawing it square.** Everything
  anybody knows about a gasholder is that it is a circle, and a box inside a box was the single
  worst mismatch between name and shape in the registry.
- ⚠ **A fan cowl is a circle** and a **transformer tank is a cylinder**. Both were boxes for the
  same reason: the arms predate `drawFacetDrum` being the quarter's default.
- ⚠ **Four `blinkLight` calls had their arguments in the wrong order** — `(rgb, alpha, now, r)`
  against a signature of `(rgb, now, seed, alpha, r)`. A blink phase driven by the frame's alpha is
  a light that does not blink, and an aviation light that ignores `alpha` is one that stays at full
  brightness into the haze. Two are in this restyle (Kerbstone Row Gasholder, Fire Station 4); the other
  two are the same typo in the same file (Ash Management, High Water Mark) and are fixed with them
  rather than left as two of four.

⚠ **THE FIRE STATION KEEPS ITS RED, AND THAT IS NOT THE RESTYLE BEING SELECTIVE.** "Glass and
chrome" is an argument about form and material; `ty_engine` is neither — it is appliance red on
three doors, and the palette block's own note says why it may never go: in a quarter of cyan and
pearl the one red thing on the skyline is the thing you look for when something is burning. A
modern fire station is chrome with red doors. That is what this now is.

⚠ **TWO BUILDINGS KEEP WARM LIGHT** — Coldwater Recital Hall and Kettle Lane Pumping Station. Both were commissioned
by people who were proud of them, decades before the estate, and both light themselves the way they
were left. It is most of what still tells you they were here first.

⚠ **THREE THINGS STAY FLAT AND HAVE TO**: the recital hall's name fascia, the auction house's
painted name plate, and the institute's frieze. `emitSurfaceText` maps a baked texture onto a
PLANAR quad, so a name on a curve arrives sheared — a curved fascia needs a glyph atlas, which this
renderer does not have. The land office's hoarding is flat for the same reason and because a
hoarding bent round a drum is a thing no printer in this city could produce.

## 5. What this deliberately does not do

- **No new palette values but one.** `ty_hf_slab` is the only addition, for the bare floor plates,
  because a shell is the one thing here that is not a FINISH: every other chrome above it was
  specified, delivered and polished, and drawn in any of them an unclad floor reads as cladding
  somebody chose.
- **No quests, no arcs, no faction content.** The quarter has NPCs who talk about the estate and
  nothing that sends you anywhere.
- **No interiors for the thirty.** See above; this is a decision with a stated conversion path.
- **No road on y919.** The Curtain's row stays verge.
- **The existing twenty-seven buildings keep their programmes.** Only their shapes and the stale
  material comments changed.

## 6. The files

```
scripts/content/halcyon/batch6.mjs   the streets and the green
scripts/content/halcyon/batch7.mjs   the twelve enterable (authorBuilding)
scripts/content/halcyon/batch8.mjs   the thirty sealed (the ruin pattern)
```

Re-runnable in that order, then `node scripts/content/mint-connections.mjs --write` and
`npm run content:lint`. All three are idempotent.

⚠ **`authorBuilding` DOES NOT CHECK MAP CODES and `content:lint` does, at the end of a run that has
already written 280 files.** Seven of the twelve collided on the first pass with buildings in four
other districts, which is what two-letter initials over 231 existing codes gets you. Both batches
now assert it before they flush.

Renderer: the eight arms and the thirteen restyles in
[windshield.js](../../client/game/js/panels/windshield.js), `ty_hf_slab` in the palette block, eight
rows in `TYPE_MODEL`, eight rows in `BUILDING_TYPE_ICON`
([derive.mjs](../../scripts/content/derive.mjs)) and eight SVGs in
`client/game/assets/zone-icons/`. Re-run `npm run shapes:bake` after any geometry change.

---

## Streetlights (2026-09-21)

The quarter shipped with 64 road tiles across eight streets, a `power_zones` row on every one
of them, and **not one streetlight** — so the newest neighbourhood in Coldwater was also the
only lit district in the city that went dark at dusk. Compare `commercial`, which is 18 road
tiles and 18 lamps. `scripts/content/light-halcyon-fields.mjs` lays 46 of them (230 kW onto a
plant carrying 2,265 of 10,000).

⚠ **Windrow Lane is deliberately unlit.** It is the perimeter service road behind the Kerbstone
Row frontage, and a quarter four hundred people short of being occupied has not got round to
lighting the back lane. That is 18 of the 64 tiles. The junction at 899,918 IS lit, because
Kettle Lane is a through street and the junction belongs to it.

⚠ **The description is not the one the other 82 streetlights share.** Every streetlight in the
game until now read "a row of city-grid streetlights on cracked poles", which is the old grid.
These are a developer's columns with the batch stickers still on them — the district's whole
read is that it is unfinished rather than worn out.

⚠ **They need no seed-runtime step and must not be given `light_on`.** Unlike an interior
fixture (which imports off and stays off for good — see
[architecture.md](../architecture.md)), a streetlight is self-healing: `syncStreetlights`
reconciles every `light_type: 'streetlight'` row against its zone's power status and *local*
ambient visibility on the 30-second and 30-minute ticks. These light themselves at dusk, and
under a passing storm cell, on their own.

The script asserts every tile it lights has a `power_zones` row and refuses to run otherwise,
because a lamp on an unpowered tile never comes on and says nothing about why.

---

## The fourth campaign — one plot, one silhouette (2026-09-22)

**Status: BUILT.** Forty-two new GLASS arms, bound by name, so no two buildings in Halcyon Fields
draw the same model. One of them is the quarter's hero.

The third campaign left the quarter with sixty-nine buildings standing on fourteen types. That is
fine on a street of shops and wrong on a skyline: **forty-two of those plots were drawing a
building one of their neighbours was already drawing**, and on Kerbstone Row you could stand at a
spot with three identical topped-out shells in a row. The whole variety argument for this quarter
is the silhouette — the palette block says so in as many words — and a silhouette repeated six
times is not one.

| Type | Plots | Kept the type arm | New arms |
|---|---|---|---|
| `shell_tower` | 11 | 7 Vetch Mews | 10 |
| `atrium_court` | 6 | Halcyon Sales Suite | 5 |
| `chrome_tower` | 6 | 1 Halcyon Boulevard | 5 |
| `cascade_block` | 6 | 8 Vetch Mews | 5 |
| `bead_tower` | 5 | 5 Vetch Mews | 4 |
| `chrome_slab` | 5 | 9 Halcyon Boulevard | 4 |
| `torque_tower` | 4 | 2 Kettle Lane | 3 |
| `glass_prism` | 3 | 2 Cinder Lane | 2 |
| `lens_hall`, `pavilion`, `vertical_farm`, `transit_halt` | 2 each | the first of each | 1 each |
| the other fifteen types | 1 each | all of them | — |

### The three rules this follows

**Bind by NAME, never by type** — `modelFor` prefers a `building_name` over a `building_type`, so
a named model takes one plot and leaves the type arm exactly where it is, still drawing its own
exemplar. **Nothing under `content/` changed.** No tile moved, no `building_type` changed, no
`flags.floors` was touched, and **no map glyph is new**: `derive.mjs` keys the icon off the TYPE,
which is right, because a map icon says what a building is FOR and all forty-two are still the
programme their tile says they are. A shell tower with a crane through its core is still a shell
tower on the map and still has no door.

**No new colours, which is what makes it safe at this scale.** Four values of chrome and two of
glass across forty-two more buildings. An estate one developer put up in one campaign has to go on
looking like one thing, and the only way to add this much variety without the quarter coming apart
is to spend all of it on shape — a forty-third palette key would undo every one of them at once.
The two arms that look like exceptions are not: `hf_pale` uses `ty_hf_marble` and *no glass at all*,
which is a subtraction, and `hf_converted` uses the shells' own bare-floor grey for the shed that
was here first.

**Every arm is written against `h`**, which is `floors × FLOOR_Z` off the tile. The proportions in
these forty-two are proportions, not heights; check `flags.floors` before tuning a fraction.

### The site, which was the richest seam and the least obvious one

Eleven plots carry `shell_tower`, and the type arm already varied them — how far the cladding got
is seeded, and the crane comes down once it nearly catches up. That is variation in a *parameter*
and it still leaves eleven buildings with one outline. What a building site actually has is eleven
different places for the work to have stopped, and each one is a different shape: nothing but the
frame; the core running four floors ahead of the plates with the jump-form shield on its head;
clad from the TOP DOWN with a protection wrap coming down rather than glass going up; inside a full
scaffold cage; stopped altogether with no machine anywhere near it; an external hoist and a stack
of loading platforms down one flank; half a tower on a whole podium with starter bars standing out
of the other half; the crane climbing *inside* the core so the mast comes out of the middle of the
roof; a flooded sheet-piled hole with the core going up out of the water; and topped out with the
crane lying across its own roof in three pieces.

⚠ **They stay the dark ones.** `shell_tower`'s own note is that fourteen models in the whole
registry emit nothing after dark, and that a quarter where every object glows has no depth to it.
Ten more lit towers would have deleted that, so every one of these is work lamps and nothing else —
except `hf_topout`, which gets two lit floors low down where the fit-out has started, and is
deliberately last in the run.

### The hero — ★ Halcyon Point (904,911)

Twenty floors, the tallest plot in Halcyon Fields, at the east end of the boulevard frontage.
**Two shafts of unequal height carrying one enormous glazed plate across the top of both**,
oversailing them on every side, lit from underneath. The brochure's photograph is taken from below
it, and it is the one building the developer put its own name on.

Why this shape and not another tall one: the quarter already has a pair-and-a-bridge in
`sky_court`, and that building's link is a *corridor* — a box slung between two towers with sky
above it. This is the opposite move. The plate is the top of the building, it is far wider than
what holds it up, and it makes the whole composition one object with a lid rather than two objects
with a connection. From the Basin it is the only flat horizontal on a skyline of points, masts and
copings, which is `glass_prism`'s argument for its needle turned upside down.

⚠ **The overhang is the building.** A plate that merely spans the two shafts is a bridge; what
makes it a ceiling is that it reaches well past both on all four sides, so from underneath you
cannot see the sky and from the air the shafts are hidden by their own roof. ⚠ **Both shafts stop
BELOW it** — a shaft that pokes through its own ceiling is a tower with a collar. ⚠ **And it is lit
from underneath for `lens_hall`'s reason**: a soffit that deep with no light on it is a black lid,
and a black lid over two lit shafts reads as damage.

⚠ **It is the only one of the forty-two that letters its own name**, and that is what makes it the
hero rather than the biggest. `SIGN_WORD`'s own rule is that what makes a street read is that the
signs say *different things* — in a quarter of identical developer product, one named building is a
landmark and forty-two are a catalogue.

### Four things that would have been silently wrong

⚠ **A moving part may never be mass.** `hf_climber` puts a tower crane in the middle of a roof, and
only its mast is drawn with the mass primitives. Everything that turns is strokes and decals,
because `motionPhase` is parked during both captures — a jib built out of boxes would be meshed and
collided at whatever angle `now = 1000` left it, for ever. `shell_tower` already carries that
warning and it bites harder here, because this mast is not off to one side where being wrong is
cheap.

⚠ **A hole has to be BUILT rather than cut.** There is no way to subtract a volume from a drum
here, so `hf_ring`'s doughnut is twelve fat segments on a circle each yawed to its own tangent, and
`hf_notch`'s missing corner is an L of two boxes with a chrome-lined reveal. That is also what
keeps them honest downstream: `modelSolid` cuts CFIT collision from these primitives, so the hole
in the ring is a hole to an aircraft as well as to the eye.

⚠ **Stacked boxes and drums must overlap in z.** Butted exactly at a plane and offset or turned
against each other — `hf_pixel`'s stagger, `hf_shard`'s lean, `hf_ring`'s segments — they leave a
sliver of sky at every joint, which reads as a ruin rather than as a curve or a shear. Every one of
those arms runs its lifts long and interpenetrating, which is the rule `torque_tower` and
`chrome_arch` already wrote down.

⚠ **`yaw` is a WORLD bearing and every arm thinks in its own local frame.** `F`/`facePt` turns a
local point into a world one and says nothing about direction, so anything with a bearing of its
own — the ring's segments, the scarf's ribbon, the fan's leaves, the scissor's two bars — has to
add `faceYaw(E)`. Leave it out and the building is correct on a north-facing tile and rotated on
the other three, which is the one facing every headless harness renders.

### What this deliberately does not do

It adds no tiles, no streets, no interiors, no doors and no content files. Thirty of the forty-two
plots still have no door, exactly as they did before, for the third campaign's stated reason — the
alternative in a quarter four hundred people short of being occupied is thirty invented lobbies.
Converting one later is still additive through `authorBuilding`.

It also does not touch the Glasshouse district next door, which has no duplicates: every building
in it already carries its own named model or is the only plot on its type.

---

## The fifth pass: addresses, not puns (2026-10-08)

**Status: BUILT.** All 68 buildings renamed, their signs with them.

Every building in the quarter had a property pun for a name (Plot Twist, Going Concern, Glass
Ceiling), and GLASS letters a building's name on its front, so the boulevard read as a row of
independent shops with jokes over the door. It is one developer's estate. An estate's signs carry a
street number or the developer's name, and that is what these carry now.

- **A building Halcyon built and lets is named by its address**: 8 Halcyon Boulevard, 15 Kerbstone
  Row. Odd numbers on one side, even on the other, counted from the end the street starts at:
  Kerbstone Row, Sorrel Way and the boulevard run west to east, Kettle Lane, Cinder Lane and Cowslip
  Rise run south from the boulevard, and Vetch Mews runs north from Kerbstone Row. The number comes
  from the tile, so a plot with a plain name still uses up its number.
- **A building Halcyon runs for itself has a plain Halcyon name**: the Land Office, Sales Suite,
  Estate Office, Site Office and Records Office, the Institute, the two halts, the substation and
  the cooling plant. The tallest plot is Halcyon Point, the developer's name on its flagship.
- **What was here before the estate keeps a plain name of its own**: Coldwater Recital Hall, the
  Kettle Lane Pumping Station, the Kerbstone Row Gasholder and the Kerbstone Row Exchange, and the
  Winter Garden, whose vault is older than the road outside it.

⚠ **The puns are not unique to the quarter.** The Filaments has a café called Grounds for Concern
(906,908 then, 908,907 now) with its own rooms, generator and vendor, and it keeps its name. Until this pass it was
also drawing the Halcyon café's model, because `NAMED_MODELS` binds by name and both had the same
one; it now draws its own type, `shop`. So the rename is scoped to rows that belong to the quarter
(its tiles, their interior maps and rooms, and the generators, power_zones, furniture and NPCs on
them), and anything outside that still sharing an old name is listed and left alone.

⚠ **It runs after batch0-batch9, and has to.** Those batches still author the old names, so re-running
any of them puts a pun back; running `scripts/content/halcyon/batch10.mjs` after
takes it out again. It is idempotent, and each prose rewrite in it throws if it finds neither its
old text nor its new one, so an edit made since cannot be skipped without anyone knowing.

⚠ **Prose that explained a pun was rewritten, not renamed.** "It is called Quiet Enjoyment
because that is a thing written into the lease" says nothing once the building is 5 Vetch Mews, and
the Institute fellows' long-running row with the estate is now about an apostrophe on the door
plate rather than the building's name. Twenty-four passages in all, listed in `PROSE` in the batch.

⚠ **The map codes were the puns' initials and went with them.** An address takes its street's
initial and the house number (`C4`, `R7`), or the bare number when it has two digits (`15`, `36`).
A Halcyon property is coded from the words after Halcyon, since all of them start with an H. Where a
code is already taken somewhere else in the world, derive's own ladder picks the next one, which is
why a few (`1C`, `W3`, `H4`) look arbitrary.

⚠ **The land office hoarding no longer letters the building's name.** It advertises the
development, "Halcyon Fields" over "Plots released", and the office's own name goes on a strap line
along the bottom with "Enquire within". The land office also takes no derived kit any more (`NO_KIT`
in derived-kit.js): the board is the plot's only box, so the kit read it as the front wall and ran
a cable across the top of the lettering, a downpipe up one edge and two fire-escape landings over
the picture.

On the client, the 42 `NAMED_MODELS` keys moved with their buildings (`glassceiling` is
`halcyonpoint`), and `building-shapes.js` and `flightsim-world.json` carry the new names.

| Tile | Name | Was | Map code |
|---|---|---|---|
| 892,909 | 1 Halcyon Boulevard | Top Brass | `H1` |
| 895,909 | 7 Halcyon Boulevard | Rising Sums | `H7` |
| 896,909 | 9 Halcyon Boulevard | Bent Double | `H9` |
| 897,909 | 11 Halcyon Boulevard | Curve Appeal | `11` |
| 892,911 | 2 Halcyon Boulevard | Common Ground | `B2` |
| 893,911 | Coldwater Recital Hall | Sound Investment | `HA` |
| 894,911 | 6 Halcyon Boulevard | Vested Interest | `H6` |
| 895,911 | 8 Halcyon Boulevard | Going Concern | `H8` |
| 896,911 | The Halcyon Institute | Course Correction | `HI` |
| 897,911 | Halcyon Land Office | Plot Twist | `OF` |
| 892,915 | 1 Kerbstone Row | Light Relief | `K1` |
| 894,915 | Halcyon Pavilion | Leaf It Out | `PA` |
| 896,915 | The Winter Garden | Glass Half Full | `WG` |
| 897,915 | 15 Kerbstone Row | Ivory Tower | `15` |
| 898,915 | 17 Kerbstone Row | Top of the Market | `17` |
| 904,915 | 25 Kerbstone Row | Sweeping Statement | `25` |
| 906,915 | Halcyon Arch | Air Rights | `H4` |
| 907,915 | 31 Kerbstone Row | New to Market | `31` |
| 908,915 | 33 Kerbstone Row | Priced to Sell | `33` |
| 909,915 | Kerbstone Row Exchange | Crossed Wires | `EX` |
| 892,917 | 2 Kerbstone Row | Party Wall | `K2` |
| 893,917 | Halcyon West Halt | Standing Room Only | `WE` |
| 894,917 | 6 Kerbstone Row | Right of Way | `K6` |
| 895,917 | 8 Kerbstone Row | Scope for Improvement | `K8` |
| 896,917 | 10 Kerbstone Row | Well Appointed | `10` |
| 897,917 | 12 Kerbstone Row | Change of Use | `12` |
| 898,917 | 14 Kerbstone Row | Rent Review | `14` |
| 900,917 | 18 Kerbstone Row | Sunk Costs | `18` |
| 901,917 | 20 Kerbstone Row | Blue Chip | `20` |
| 902,917 | Halcyon Records Office | Stamp Duty | `RE` |
| 903,917 | Halcyon Cooling Plant | Cold Comfort | `PL` |
| 904,917 | Halcyon Site Office | Snagging List | `H3` |
| 905,917 | Kerbstone Row Gasholder | Holding Pattern | `KR` |
| 906,917 | The Palm House | Frond Memories | `P2` |
| 907,917 | Halcyon Substation | Current Affairs | `H5` |
| 908,917 | Halcyon East Halt | Line of Enquiry | `EA` |
| 909,917 | 36 Kerbstone Row | Best Offer | `36` |
| 898,911 | 1 Kettle Lane | Salad Days | `L1` |
| 898,913 | 5 Kettle Lane | Second Wind | `K5` |
| 900,911 | 2 Kettle Lane | Above Board | `L2` |
| 900,912 | 4 Kettle Lane | Under Offer | `K4` |
| 900,913 | Kettle Lane Pumping Station | Mains Attraction | `KL` |
| 900,914 | 8 Kettle Lane | Chain Free | `L8` |
| 900,915 | 10 Kettle Lane | Sitting Tenant | `1K` |
| 901,911 | 1 Cinder Lane | Safe as Houses | `C1` |
| 901,912 | 3 Cinder Lane | Fixed Rate | `C3` |
| 901,913 | 5 Cinder Lane | Break Clause | `C5` |
| 901,914 | 7 Cinder Lane | Root Cause | `C7` |
| 901,915 | Halcyon Estate Office | Ground Rent | `EO` |
| 903,911 | 2 Cinder Lane | Overlooked | `2C` |
| 903,912 | 4 Cinder Lane | Prime Location | `C4` |
| 903,913 | 6 Cinder Lane | Vacant Possession | `C6` |
| 903,914 | 8 Cinder Lane | Mod Cons | `C8` |
| 903,915 | 10 Cinder Lane | Aspect Ratio | `1C` |
| 904,911 | Halcyon Point | Glass Ceiling | `PO` |
| 904,912 | 3 Cowslip Rise | Subject to Contract | `R3` |
| 904,913 | 5 Cowslip Rise | Peppercorn | `R5` |
| 904,914 | 7 Cowslip Rise | Completion Date | `R7` |
| 906,914 | 8 Cowslip Rise | Dual Aspect | `R8` |
| 892,914 | 1 Sorrel Way | Long Lease | `S1` |
| 895,913 | 3 Sorrel Way | Fixed Assets | `W3` |
| 896,913 | 5 Sorrel Way | Grounds for Concern | `S5` |
| 897,913 | 7 Sorrel Way | Fit for Purpose | `S7` |
| 895,915 | 4 Sorrel Way | Deposit Taken | `S4` |
| 892,913 | 5 Vetch Mews | Quiet Enjoyment | `V5` |
| 892,912 | 7 Vetch Mews | Rising Damp | `M7` |
| 894,913 | Halcyon Sales Suite | Artist's Impression | `HS` |
| 894,912 | 8 Vetch Mews | Terms Agreed | `V8` |
