# Fairweather Marina — the west shore gets a boatyard *(as built)*

**Status: BUILT.** Seven world tiles re-dressed, one building with four rooms, two new GLASS
arms, one map icon, and four verbs on `plugins/powerboat/`. The drive verb and the boat cockpit
panel are still to come and are deliberately not here.

Built 2026-09-21, on the west shore at the head of Halcyon Boulevard, between the Glasshouse and
the water.

---

## 1. Why here, when the standing rule says not here

The standing note in [building-styles.md](../reference/building-styles.md) §2.1 is blunt: *"the
quarter is not where new development goes"*, because anything built beside the Glasshouse arrives
wearing Ascendant voice by proximity. That rule is about development that would be better off
central. This is the exception it anticipates rather than a breach of it, for one reason: **the
thing being built is a luxury asset, and the Ascendants are who owns luxury assets.** A marina on
the industrial waterfront would have to be a working harbour, and the city already has one of those
two hundred tiles east — the jetty, the quay, the cranes and the Beacon.

So the proximity that the rule treats as a hazard is the whole point here. It is their doorstep, it
is their marina, and it reads as theirs before a word of prose is spoken.

**The Echelon is why the site works.** She moors at 897,898 and her gangway comes down on the Basin
Jetty at 897,901, three tiles east of the new pontoons. The biggest boat in the game was already
parked on this shore; what was missing was anywhere for anybody else's.

⚠ **Neither of those tiles is touched.** 897,901 keeps `flags.pier`, which is what
`plugins/yacht/index.js` docks her gangway to, and 897,898 already carries two zones.

## 2. The streets came first, because there were none

`sitecheck.mjs` passes exactly **one** tile in this whole corner — 894,903, off the head of Halcyon
Boulevard — and fails every other candidate with the same line: *no standable road neighbour
(nowhere to put the door)*. The shore is sand with nothing on it. Same finding, and the same
consequence, as [old-coldwater.md](old-coldwater.md): a quay has to be laid before anything can
front onto it.

| tile | was | is |
|---|---|---|
| 894,903 | Grasslands, sand | **Halcyon Quay** — the boulevard reaching the water |
| 893,903 | Grasslands, sand | **Halcyon Quay** — running west behind the Conservatory |
| 892,903 | Grasslands, sand | **Halcyon Quay** — the west end, under the Curtain |
| 892,902 | Grasslands, sand | **The Hardstanding** — open cradles, 2 lettable |
| 894,902 | open water | **Fairweather Marina** — inner pontoon, 6 berths |
| 894,901 | open water | **Fairweather Marina** — outer pontoon, 4 berths |
| 893,902 | Grasslands, sand | **The Conservatory** — the covered bay (facade + 4 rooms) |

The quay is `terrain: road` and that is load-bearing rather than cosmetic: `authorBuilding`'s
`streetFor` refuses an entrance whose neighbour is not a road, and without it the auto-tiler does
not run the boulevard down to the water. It does now — the snapshot has 894,903 as `rd: "sw"`,
turning west along the shore.

**The quay keeps the quarter's word and the marina does not.** Halcyon Quay is the boulevard's own
continuation and should say so; the marina is a business standing on it.

## 3. Three rules the tiles are built on

**⚠ A PONTOON IS `building_type` AND NOT `is_building`.** A facade is a non-standable revolving door
and leaves the walk graph; `building_type` alone renders a model and joins the CFIT collision sweep
while staying a tile you walk on. Authored the other way, the marina is a boat-shaped hole you can
fly into and cannot walk onto. This is the same rule the tent camps and the berth marker are built
on, and the flag set that makes a water tile standable (`pier`, `liquid: false`, `swimmable: false`,
`routable`) is lifted wholesale off the central pier rather than reasoned out again — get one of
the four wrong and you have either a deck you swim through or open water you can walk across.

**⚠ THE DISTRICT IS `glasshouse`, NOT `docks`.** The docks signature is *"brine and diesel and
rotting rope"*, which is the wrong quarter entirely. Adopting `glasshouse` means the district
ambience already reads correctly — filtered air, a fountain nobody may drink from, cold even light
— with nothing authored.

**⚠ AND THE CAPACITIES ARE WHAT IS LETTABLE, NOT WHAT IS STANDING THERE.** The Hall's prose says
four of six cradles are occupied and the Hardstanding's says the same; those four are other
people's boats and are scenery. Occupancy is counted against the `boats` rows, so authoring the
full six would print "0 of 6 taken" in a room the player can see is two-thirds full.

## 4. The Conservatory

A glass hall a hull is lifted into, parked in and worked on. The name is the joke and the joke is
the quarter's: a conservatory is a glass building **and** a place things are conserved, which is
the Ascendant promise pointed at a boat instead of at a person. They will not let it decay and they
will charge for that.

Four rooms — the Hall (the covered dock, the travel hoist, the cradles, the water door), the Bench
(the workshop, and the first room on this shore that smells of anything), the Counter (the
chandlery) and the Gallery (a mezzanine where Marit lives) — plus the Tank Room underneath, which
keeps the water inside the building level with the water outside it.

**⚠ THE ONE PERSON IN AN OTHERWISE UNATTENDED MARINA IS THE POINT.** The berth plinth outside says
NO ATTENDANT IS PROVIDED and means it — the machine takes your money and the absence is the
faction statement. Marit Colvane is here because a hull needs hands and the quarter has not worked
out how to automate that, which makes her the only person on this shore who touches anything. Her
own line about it: *"They wanted the whole yard automatic… Then it did the next one exactly the
same, and the next one after that, and a hull isn't a next one, it's whatever came in the door."*

The building's quiet centre is bay three: a boat nobody has come for in two years, strapping
checked, engine turned over twice a year, account paid on the day every quarter. She will tell you
about it. She will not tell you whose it is until you are paying her too.

## 5. The two GLASS arms

`type:pontoon` and `type:boathouse`, both in the Glasshouse register — glass, translucency, chrome.

**⚠ A PONTOON SECTION IS SYMMETRIC**, for exactly the reason the pier's is: it is one tile twice in
a row, each with an entrance facing derived from a door that is not there, so any feature placed on
a "front" points a different way on the two of them.

**⚠ AND IT FLOATS, WHICH IS THE WHOLE SILHOUETTE.** The pier is a slab held clear of the water on
braced columns and the gap under it is what says *structure*. A pontoon is the opposite statement:
no legs, freeboard you could step over, riding the water so closely it reads as a pale line lying
on the basin. Drawn as a low pier it is a short pier, which is a building the city already has.
What makes it read as a **marina** rather than a jetty is the **comb** — fingers out both sides
dividing the water into boxes one boat wide — and the **pedestals**, a power post at the root of
each, which is the fitting a marina has and a pier does not, and after dark the only light out
there. ⚠ Deliberately no lamp standards: a run of tall columns marching away is the pier's own
picture, and on Ascendant ground the light comes from inside the thing rather than off a pole.

⚠ **A finger reaches just past the tile edge, never a whole tile.** The first cut centred them at
1.52·fh with a 0.74·fh half-width — an outer edge 0.99 tiles from the middle of the pontoon, a
walkway clean across the neighbouring water. `tilefit` does not catch it and is right not to: it
trims the entrance side only, because mass pushed sideways here is over open basin rather than over
a road. The number has to be right rather than caught.

The Conservatory is a chrome plinth, an etched-glass hall, a glazed barrel vault running
front-to-back so the gable faces the quay, a full-height water door at the seaward end, a hoist
gantry along the ridge, and a chrome fascia carrying the name.

⚠ **`ty_aur_pearl`, NOT `ty_aur_frost`, AND THAT WAS MEASURED RATHER THAN CHOSEN.** Both are
`FROST_WALL`, so both are "etched glass" by family — but `ty_aur_frost` is `[74,52,92]`, a dark
aubergine, and a dark wall under daylight shading resolves to grey-lavender. Sampled off a real
preview it came back `88,88,96` and `112,104,120` across the flank, which is stone; the building
read as a Nissen hut. ⚠ **And the material response is no help here** — the frost BRDF is a GLASS 2
feature (`glMat`), so on the 2-D painter a palette key is a colour and a texture generator and
nothing else.

⚠ **THE MULLIONS ARE WHAT MAKES ANY OF IT READ AS GLASS.** No colour on its own says *glazed* — a
pale wall is a pale wall. What a curtain wall looks like is a regular rank of vertical bars with
light between them, so the bars carry the read and the tint only supports it.

⚠ **AND THE ROOF DECIDES WHAT THE WHOLE BUILDING IS**, because the vault is 35% of the height. At
`[150,196,210]` it sampled back as `104,144,152` over 2,598 pixels — the most common colour in the
frame, and a desaturated blue-green that size reads as a slate or copper dome rather than glazing.

⚠ **The hoist slings are not drawn.** They hang from the crab *inside* the hall, so a stroke from
the ridge down to the water is authored straight through the roof; `glself` measured exactly that,
11 stroke points inside their own host. There is nothing to salvage by pulling it forward either —
the flank is etched right through, so the one thing you cannot make out from outside is the shape
of a sling. The Hall's own prose carries them, where somebody standing under them can see them.

Both types are in `NO_KIT`/`UNSIGNED_TRADE` as appropriate: the pontoon because the derived kit
reads unyawed boxes and would hang window bays and a roller shutter on a deck, and both because the
Conservatory letters itself and a derived board would be the building's own name a second time.

The map icon is `bldg_boathouse` — a vault with a hull under it and the sling coming down off the
apex. ⚠ Deliberately not `bldg_wharf` or `bldg_warehouse`: both of those are a shed with cargo in
it, and the whole of what makes this building itself is that the roof is over a **boat**. The
pontoon needs no icon and gets none — the lookup is facade-gated.

## 6. The boatyard

The powerboat row in [plugins.md](../plugins.md) carries the reference; the design decisions are
there rather than repeated here. The short version: a boat is a `boats` row, `berth_zone` points at a zone, and
the three kinds of place are **content flags rather than coordinates** — `marina_berths: N` afloat,
`boat_hardstanding: N` on a cradle outside, `boat_covered: N` under a roof, plus `boat_dealer` for
somewhere that sells them. A second game built on THOMAS gets all of it by painting flags on tiles;
nothing in `yard.js` knows the word Fairweather and nothing in it knows a coordinate.

Four verbs: `boats` (your fleet, anywhere), `boat` (the stock list, and buys one), `berth` (the
board here, and moves a hull in), `refit` (the hull). Getting in and out is flight's `board` and
`disembark`, reached through a third rung on the ladder `tryVesselAction` already walks for
swimming's vessels.

⚠ **`refit` because `fix` and `repair` are both taken** — `fix` by trucking, `repair` by flight and
wear. A plugin verb silently beats an engine builtin, so a collision there is not a load error, it
is one of two systems quietly ceasing to work.

**What a refit can reach is decided by where you are**: a field patch 55%, a cradle 80%, a shed
with a shipwright in it 100%. That ladder is the entire economic argument for paying for a roof,
and it is asserted in regress rather than trusted.

## 7. What is not built

- **The drive verb and the boat cockpit.** The sim exists and is regress-tested; the panel and the
  verb are the next piece and are a large one — the trucking cab is the scale.
- **Rent cycles.** Berthing charges a move-in fee. Nothing bills you per cycle, because that needs
  a ledger and a tick and neither exists for boats yet; the plinth quotes a rate it does not
  currently collect.
- **NPC-owned hulls as rows.** The four covered cradles and four outdoor ones are prose. Bay three
  is a story, not a `boats` row, which is why the capacities are authored as the lettable count.
