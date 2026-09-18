# Coldwater Infill — fourteen buildings the city has no analogue for

**Status: all fourteen are BUILT.**

Coldwater has 105 enterable facades and 173 hand-written building models. It has three pawnbrokers,
two laundromats, two banks, four places to get a drink and six ways to buy a gun. What it does not
have is anywhere to *go*. Every leisure building in the city is a place you buy something at: the
casino takes your money, the bathhouse washes you, the club plays at you. Nothing in Coldwater is a
room you sit down in for two hours because you wanted to.

That is the hole this roster fills, and the reason it is worth filling is in the theme bible rather
than in any system doc. [story.md](../story.md)'s themes 2 and 4 — *systems outlive their purpose*
and *nostalgia is a trap* — are the two the built city expresses least. A power plant that has run
with no fuel deliveries since before the Handoff is theme 2 done perfectly, and it is the only
example. A lending library still charging fines, a bookmaker still settling on a league nobody
organised, a cinema still running one reel at a time: each of those is the same joke the power plant
tells, in a building you can walk into.

## The rule this follows

**Infill, not expansion.** Every site is a tile that already exists inside the built street grid,
already has a name and a description, and already fronts a named road. Nothing here pushes the city
edge out, adds a street, or moves a building. The survey behind it: of 4,837 Coldwater tiles at
`grid_z: 0`, 105 were facades before this and 81 of the open ones are legal sites — see *Is this
tile a legal place to build?* below, which is the check that produces that number and is a good
deal stricter than the adjacency count the roster was first drafted against.

**A new silhouette, not a recoloured shop box.** `drawTypeModel`'s `shop` arm is `default` — four
named types bind to it and every unbound `building_type` falls through it — so a building whose
model is "the shop box in a new colour" is a building that adds nothing to the skyline. Each entry
below names the shape that is new about it, and that test killed four other candidates outright: a
stationer, an optician, a tobacconist and a bottle shop are all one glazed shopfront and a fascia,
which Coldwater already draws thirty times.

**A system it can stand on.** Nine of the fourteen hook a system that already ships and currently
has no physical address in the world. That is the difference between a shop and a set: the
bookmaker settles on leagues [systems-broadcast.md](../systems-broadcast.md) already simulates, the
library lends books [systems-library.md](../systems-library.md) already holds, the cobbler is a
bench repairman under [systems-durability.md](../systems-durability.md)'s existing `repairman` flag.
None of them needs a line of new engine code to be worth entering.

## Built — batch 1, the four that carry the themes

| # | Name | `building_type` | Site | Entrance | Marker | Vendor | Hooks |
|---|------|-----------------|------|----------|--------|--------|-------|
| 1 | **Reel Estate** | `cinema` | 912,914 Meltwater Row | west | `RE` | Gower Nissen | betatapes, [instruments](../systems-instruments.md) |
| 2 | **Photo Finish** | `bookmaker` | 914,914 Kiln Lane | east | `PF` | Ada Glennie | [broadcast](../systems-broadcast.md) sports leagues |
| 3 | **Stuff It** | `taxidermist` | 917,914 The Gate Road | east | `TX` | Marnie Vandersloot | fauna, hunting, the Wildlands road |
| 4 | **Fine Print** | `lending_library` | 903,908 Greenside Yard | north | `LI` | Lowell Ashgrove | [library](../systems-library.md) |

Each is a facade tile plus two or three interior rooms and a utility room, its own interior map, a
generator and a `power_zones` row and a lit fixture per room, a junction box, a vendor with a full
dialogue tree and a safe, its stock as real items, a hand-written `drawTypeModel` arm with its own
palettes, a registered map icon, and its props. 112 new content files and four new arms.

### 1. Reel Estate — the dead cinema, which was already canon

Coldwater's prose has referred to a dead cinema for months. From Chrome Court's roof you can see
"the whole Marquee below in pink and cyan, the dead cinema and the precinct floodlights", and there
was no cinema anywhere in the world. This builds it, and does not resurrect it: one screen, one
projectionist, one reel at a time, and a schedule that is whatever he could get the sprockets
through this week.

**The silhouette.** The only building in Coldwater whose shape is advertising. A low deep foyer
under a projecting canopy, a windowless auditorium box behind it rising to a blind fly loft, and a
vertical blade sign taller than the building it is bolted to with a third of its bulbs out. Nothing
else in the city has a sign that is structurally the tallest thing on the plot. The canopy is the
second new shape: a slab cantilevered out over the pavement with its underside lit, which is a
soffit nobody else in the city has.

**Why it is at 912,914.** Meltwater Row runs south out of the Marquee, past the statue, and gives
out into the Slag Pan. A cinema is the last lit thing on the way out of town, next door to the Grind
House and opposite the park. The site is currently `Grasslands`, `district: wasteland`, carrying
`scavenging_table_id: scav_west_wastes` — a tile the world had forgotten about, one block from the
TV studio.

**The joke.** Gower Nissen rents the flats above the auditorium and shows films to an average of two
people a night, so the cinema is the part of the cinema that loses money. He can tell you how much,
to the credit, without looking it up. He will not close it, and asked why, he says he does not know,
and is annoyed that that is the true answer.

**What is in it.** A foyer with a kiosk and a confectionery cabinet holding four lines spaced to
look like nine. An auditorium of 180 seats, six of them reupholstered, which is where everybody
sits. A Wurlitzer in the pit on a lift that stopped rising, wired as a playable `instrument: organ`
(the one blown voice in [procedural-sfx.js](../../client/shared/procedural-sfx.js)'s table, and the
second one placed in the world after St Garneau's). And a projection box with a cast-iron projector
that is threaded and a plastic tape deck on a milk crate that is what actually feeds the screen. The
screen is a `broadcast_receiver` on channel 0 and the deck holds three real betatape broadcasts, so
`watch screen` works and what is showing is The Meter Reader, the adaptation Emmett Sloat two
districts away will tell you at length is a crime. Nissen agrees with him.

### 2. Photo Finish — a bookmaker for leagues that already play

[systems-broadcast.md](../systems-broadcast.md) runs two live-assembled sports: Deadball baseball
and Cluster Puck hockey, each with a league, standings and a narration seam. You can watch both.
There has never been anywhere to put money on either, which for this city is the odd part.

**The silhouette.** The building that is all fascia and no window. Bookmakers glaze obscure or board
over, so the frontage is a blank painted panel with a door in it, and everything that says what the
building is hangs off it: a big double-sided clock on a bracket, and a horizontal results lightbox
running the full width of the parapet with figures crawling across it. It is the only building in
Coldwater lit entirely by its own signage with no lit interior behind the glass.

**Why it is at 914,914.** Kiln Lane, on the back side of the Marquee, one door south of the Acid
Test and two from the Grind House. The entertainment quarter is where a bookmaker belongs: people
come out of the pictures and put a line on the hockey, and the shop is open until two because that
is when they do it. The adjacency is also the joke. The Acid Test is an assay office, which tells
you what your metal is really worth; this tells you what your opinion is really worth.

⚠ **It was sited at 921,912 first, and that was wrong in a way that is worth writing down.** That
tile looks like the best infill site on the map — open grass with buildings on three sides, in the
middle of a finished block between a bank and a butcher. It is Citadel Financial's front garden.
The bank's `world_exit_zone` is that tile, so building on it took the bank's only way out to the
street, and because a facade is a non-standable revolving door the bank could not have been given
it back. **An open tile inside a block is more likely to be somebody's street access than to be a
gap**, and that is the reason the rule below exists.

### 3. Stuff It — the taxidermist on the road in from the Wildlands

The sign reads STUFF IT, and underneath, smaller: MOUNTS · TANNING · SKULLS · NO PETS.

**The silhouette.** Two new shapes. A canted display window — taxidermy is entirely window, so the
glass leans out over the pavement rather than standing in the facade, which no other building here
does — and a mounted animal on a roof bracket above the sign, a real silhouette standing proud of
the roofline. From the air the tile has a creature on it. There is a third read at truck-cab
distance: the tannery flue out the back, a stove pipe well off the ridge with a cowl on it, because
what happens behind the shop is chemistry.

**Why it is at 917,914.** You come back into Coldwater from the Wildlands through the South Gate and
up The Gate Road, and this is the first shopfront you pass with something dead in the window. It
also puts a buyer for what you shot within one tile of the road you shot it beside.

**The rule it obeys.** Nothing in this building is funny about the animals. It is funny about the
customers. See the tone note at the end.

### 4. Fine Print — a lending library still levying fines

[systems-library.md](../systems-library.md) ships nine public-domain books, a tablet reader, RP
narration and a tap-to-gloss vocabulary layer. Nothing in the world is a library. The Hall of
Records is records, which is a different building and says so.

**The silhouette.** The only building in Coldwater lit from above. A lantern roof — a raised glazed
monitor running the length of the reading room, which at night makes the roof the brightest part of
the tile and casts light UP. Under it a blind masonry box with no shopfront at all and a short flight
of stone steps to a raised door, because a library is a building you go up into. Set against the
Marrow Street strip's glazed frontages, it reads as a completely different century, which it is.

**Why it is at 903,908.** A three-road corner — Greenside Row north, Voss Avenue south, Cinder Lane
west — currently authored as the service yard behind the Greenside parade. A corner site is what a
civic building wants, and this is the only unbuilt one in the commercial district.

**The joke.** The fines are real, they compound, and they are the only enforcement mechanism left in
the Basin that has never once failed to collect.

## Built — batch 2, and a place rather than a list

| # | Name | `building_type` | Site | Entrance | Marker | Vendor |
|---|------|-----------------|------|----------|--------|--------|
| 5 | **Pocket Money** | `pool_hall` | 912,915 Meltwater Row | west | `PK` | Hesper Moye |
| 6 | **The Penny Drops** | `amusements` | 910,915 Meltwater Row | east | `PD` | Winnie Alabaster |
| 7 | **The Codfather** | `fishmonger` | 903,905 Filament Street | south | `FM` | Ignatius Fawle |
| 8 | **Sole Survivor** | `cobbler` | 900,907 Filament Street | north | `CB` | Oswin Trapnell |

**Two of these make a district, and that was the point of putting them where they are.** The pool
hall and the amusements face each other across the south end of Meltwater Row, with the cinema one
tile north of one of them and the bookmaker a street away. Four buildings within sight of each other
turn the bottom of the Marquee into the cheap end of the entertainment quarter — pictures, a frame,
a penny in a machine, a line on the hockey — which is a *place*, where four buildings scattered
across four districts would have been a list. The two Filament Street trades do the same job at a
smaller scale: a fishmonger and a cobbler two doors apart make the street read as a street that
people live on rather than a row of authored landmarks.

**Pocket Money** puts its front door on the first floor, up an external steel stair, which nothing
else in Coldwater does: a dead shuttered lock-up at street level and a long hall above it with a
clerestory band down the side. ⚠ Its night glow is at the **clerestory, not the pavement** — eight
shaded lamps hung low over eight tables put nothing on the street, and a pool at the door would
draw a lit entrance where there is a dark stair with one bulb at the turn. The light is the rent
(a brass token buys an hour of the lamp over one table, and when it goes out it goes out); Hesper
Moye racks for anybody and will not play a customer, and can tell you exactly why.

**The Penny Drops** is the building with no front wall — two piers, a lintel and the lit back of the
room standing in the gap, because the shutter is up and the elevation is an opening. ⚠ Its pool is
on the **pavement**, the exact opposite of the pool hall's and for the inverse reason: there is no
wall to stop it. Winnie Alabaster will tell you, unprompted and accurately, which of her own
machines are worth your money tonight, and her reason for that is arithmetic before it is kindness.

**The Codfather** has no glazing at all: a marble slab the width of the frontage under a canvas
awning, with the ice melting off the front edge into a gutter that has not been dry in living
memory. His scale is a quarter of an ounce in the customer's favour, set by his father, deliberately,
and never corrected. He is wearily aware of what his grandfather named the shop.

**Sole Survivor** is the smallest building in Coldwater and is drawn at a scale nothing else here is:
eleven feet wide, one slope of roof off the neighbour's gable, and a window at **bench height**
rather than eye height, so what the street sees through it is a pair of hands. A boot the size of a
coal scuttle hangs over the door on an iron bracket, repaired twice itself. He is a
`repairman` under [systems-durability.md](../systems-durability.md), and he will tell you how you
walk within four seconds of seeing your boots.

## Built — batch 3, the last six

| # | Name | `building_type` | Site | Entrance | Marker | Vendor |
|---|------|-----------------|------|----------|--------|--------|
| 9 | **Negative Equity** | `photographer` | 895,904 Halcyon Boulevard | west | `NE` | Benedetta Salis |
| 10 | **Skeleton Crew** | `locksmith` | 898,905 Filament Street | south | `SK` | Rufus Bandy |
| 11 | **No Regerts** | `tattooist` | 901,905 Filament Street | south | `IK` | Nell Prudhoe |
| 12 | **Paws for Thought** | `vet` | 926,912 Kessler (residential) | south | `VT` | Constance Tiplady |
| 13 | **Spirit Level** | `off_licence` | 919,914 The Gate Road | west | `SP` | Dermot Cassavetes |
| 14 | **Past Perfect** | `museum` | 916,914 Kiln Lane | west | `MU` | Horace Mullan |

**Negative Equity** is a photographer four doors from the Ascendant chrome clinic, and the site is
the building. Its roof is a whole glazed slope facing NORTH, away from the sun, which is what every
purpose-built studio in history has in common and which reads from the air as a building with a
mistake in it. The sittings diary has a third column headed with a dash, most entries are one word,
the word is usually CHROME, and they cluster in the two days before an operating list. Nobody has
ever told her that is why they are there.

**Skeleton Crew** is the narrowest mass in the whole switch — a third of a tile — with a nine-foot
iron key hanging off the corner of it. The proportion is the joke and it is also literally true of
every locksmith that has ever existed, because a shop four feet wide has to be findable from the end
of the street. He cuts keys and he opens doors, they are two services, and he will not do the second
for somebody he has not done the first for.

**No Regerts** is a vertical strip of light up a dark building: the trade is upstairs and the stair
window runs the full height of the flight with the flash pinned across it, lit all night. The room
at the top is clinical and startles everybody. The sign has been misspelled for twenty-two years
on purpose, and the reason is the best line in the building.

**Paws for Thought** is the only domestic building in Coldwater doing business — brick, a pitched
roof, a chimney, and a square bay window with a waiting room behind it. She talks to the animal
first and the owner second, every time. ⚠ She will not fit chrome to an animal, and her reason is a
one-paragraph statement of the game's own ethics that never once raises its voice. She has also seen
[Cathode](../systems-strays.md) and has opinions about whoever did that work.

**Spirit Level** is one lit rectangle on a black building: a folding grille over the whole frontage,
glass block instead of glass, and a hatch cut in a steel shutter with a turntable in the sill so
that nothing passes hand to hand. ⚠ Its night pool is deliberately tight and at the hatch, so from
up the road it is a bright hole rather than a lit shop. The door has not opened in eleven years and
the story of why is not the story you expect.

**Past Perfect** is four columns and a pediment on a building one room deep: a joke somebody BUILT
rather than told, and the only classical order in Coldwater outside the bank and the Hall of Records,
both of which are the real thing at three times the size. It is free and always has been. The
catalogue is scrupulous — provenance, finder, date, cross-referenced three ways, and never once
wrong in nineteen years. The forty-line wall panel headed THE HANDOFF: A CHRONOLOGY is almost
entirely incorrect and is laid out so carefully that people read all of it. Both of those are true
of the same man and they are not in tension in him at all.

## Is this tile a legal place to build?

Four ways a site that looks perfect is not one, and a facade is what makes all four bite: stepping
onto one forwards you through the seam (`resolveFacadeTransit`), so building on a tile **removes it
from the walkable graph**.

1. **It is another facade's `world_exit_zone`.** That building loses its only way out, and cannot be
   given it back, because the replacement is not standable either. This is the one that bit.
2. **It has no standable road neighbour**, so the new building has nowhere to put its door.
3. **It is a cut vertex** of the walk graph, so removing it splits the map in two.
4. **Something already points at it** — an NPC home or work zone, a spawn, a quest objective.

[`scripts/content/sitecheck.mjs`](../../scripts/content/sitecheck.mjs) answers all four by
flood-filling the graph with the candidate deleted. Bare, it sweeps every open core tile; with
`x,y` arguments it explains one. Of 438 open core tiles it passes **81**. The sweep is also the honest version of the "28 candidates" figure in the
first section, which counted adjacency and nothing else.

Once a building is in, [`scripts/content/verify-infill.mjs`](../../scripts/content/verify-infill.mjs)
is the behavioural check: it boots the world against the live DB and asserts, for each of the four,
that the tile is an enterable facade, that its icon resolves, that the entrance arrow and the
street's exit and the interior's way out all agree, that every room is powered and reads
bright/clear rather than being scored as open air, that the vendor is in their work zone with stock
that resolves to real items, and that nothing in Coldwater was stranded by the four tiles leaving
the walk graph. 72 checks. ⚠ `zone_echelon_exterior` is exempt from the last one by name: the yacht
is reached by a dynamic `in` exit rather than a grid link, so it is legitimately not in the graph,
and leaving it in reports a permanent false positive that trains you to ignore the check.

## Three things the build got wrong first

- **A facade's `world_exit_zone` is the STREET; an interior's is the FACADE.** The two fields have
  the same name and hold different things, and getting the interior one wrong is invisible until
  `content:lint` compares it against the interior map's `parent_zone_id`. It flagged all 13.
- **Every exit needs a `content/connections/` row**, one per undirected pair, or the `zone_edges`
  projection silently drops it and the door does not open. 17 were needed here.
- **`marker` collides silently.** Fine Print wanted `FP`; Fallow Provisions has had it for months.
  `content:lint`'s MARK-4 check catches it, and the code is now `LI`.

And one the gates caught before it could be wrong: **`shapes:smoke` refused the taxidermist's tile**
the moment it existed with no arm behind it ("1 building tile(s) resolve to 'type:taxidermist',
which has no model — they draw through the archetype path and OCCLUDE NOTHING"). The tile and the
arm are one job, and the suite already knew.

## A note on the taxidermist's sign, because it is the one deliberate exception

Every other name in `drawTypeModel` goes on through `marqueeBand` or `neonBlade`, and both light up
after dark. Stuff It's goes through `bakeSignText` + `emitSurfaceText` with **`dn: 0`** rather than
the `night ? 1 : 0` every other caller passes, so the lettering is paint and stays paint. Measured
in the Modelshop at full night, the building reports **0 grads · 0 blurs**: it is the one shopfront
on The Gate Road that is genuinely dark. Nobody walking up from the South Gate after six can read
it, and she has never thought that was a problem worth money.

## Shipping it

Content and the renderer both reach prod through an ordinary push ([content-pipeline.md](../content-pipeline.md)).
⚠ **One manual step afterwards:** `light_on` is an export-excluded runtime column, so an additive
deploy lands every new fixture OFF, and the sweep that turns them on is local-only inside
`content:import`. After the deploy, run `node --env-file=.env.prod scripts/content/seed-runtime.mjs`
once, or all thirteen new rooms are scored as **open air**: lit by the sun and pitch black at night.

## What is deliberately not here

**No new streets, no new districts, no city-edge growth.** Several of the strongest candidate
buildings want a plot Coldwater does not have — a bowling alley, a swimming baths, a dance hall and
a fairground are all footprints two or three tiles across, and the only places that size are outside
the grid. They belong to an expansion, not to an infill. See
[roadmap-world-expansion.md](../roadmap-world-expansion.md).

**No second implementation of anything, and that is the biggest deliberate gap.** The pool hall has
no pool in it. The bookmaker takes no bets. The cobbler is flagged `repairman` and inherits the
bench repair that already exists, and beyond that nothing here adds a verb or a mechanic. A venue
and the game inside it are two changes, and shipping the venue first is what tells you whether the
game is worth writing — the pool hall now exists as a room with eight tables, a light meter and a
host who will not play you, and whether that wants a frame of pool simulating is a question somebody
can now answer by standing in it.

**Four candidates cut for having no new shape:** a stationer, an optician, a tobacconist and a
bottle shop are each one glazed shopfront under a fascia. Coldwater draws that thirty times already.
Spirit Level survives at #13 only because the night hatch changes the elevation.

## What the fourteen cost

122 content files in batch 1, and 341 across all three: 14 facade tiles rewritten, 27 interior rooms,
14 utility rooms, 14 interior maps, 14 generators, 55 `power_zones` rows, 55 light fixtures, 14
junction boxes, 71 connections, 14 vendors with full dialogue trees, 57 props and 53 items. In the
renderer: 14 `drawTypeModel` arms, 44 new palettes, 14 `TYPE_MODEL` rows and 14 map icons. The
model count went 213 → 227 and `shapes:smoke` is green on all of them.

The scaffolding that made batches 2 and 3 affordable is worth keeping if the city grows again: one
function takes a building spec and emits the facade, the rooms, the util room, the map, the
generator, the power rows, the lights, the junction box, the connections and the neighbour exit
surgery, so a new building is prose, props, a vendor and an arm rather than forty files of
boilerplate.

## Tone notes for whoever writes the prose

Read [story.md](../story.md) first. Three rules that bit during batch 1:

- **No em dashes** in any NPC dialogue, banter, chitchat or narration around it. The dash is an
  Ascendant and Architect voice tell and nobody else gets one.
- **The taxidermist is not funny about the animals.** Every laugh in that building is at the
  expense of a customer, an insurance form or a man's opinion about glass eyes. The moment the
  animals are the joke, the shop becomes a different and much worse shop.
- **A description is 300 characters or fewer** ([items.md](../items.md)), and it is read in a room
  list, on a shelf and in `examine`, so it has to earn its length in the smallest of those.
