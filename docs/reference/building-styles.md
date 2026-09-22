# Building styles — the quarters of the Basin

**Status: Coldwater (§2) is AS BUILT; the regions and the orders (§3) are part built and part
design, and each entry says which.** Every number here was measured off the shipping registry and
the baked world on 2026-09-20.

This is the **art direction**: what a building in a given quarter is made of, how it signs itself,
what colour it burns after dark. The *mechanics* are elsewhere and this doc deliberately does not
repeat them — [building-shapes.md](building-shapes.md) for the geometry and the affine capture,
[tools/modelshop/README.md](../../tools/modelshop/README.md) for the authoring surface and the
detail vocabulary, [world-rendering.md](world-rendering.md) for how a DB tile becomes a building.

Read this before you author a new building or repaint an old one. Read the other three before you
change how one is drawn.

---

**Pasting an order into an image model?** [concept-art-briefs.md](concept-art-briefs.md) holds a
self-contained brief per order, derived from this page and the org files.

## 1. The two axes the renderer actually has

Nothing in the code takes a "style" as an argument. Everything is derived from two things:

**THE MATERIAL FAMILY.** A palette key resolves through `wallMaterialOf` to one of twenty families,
and the family decides both what the wall looks like and how it answers the light. There are 416
keys today, distributed very unevenly:

| family | keys | what it is |
|---|---:|---|
| `plain` | 156 | flat painted panel — soffits, kerbs, kiosk flanks, crane bodies, clad panel |
| `window grid` | 86 | the default facade: a lit grid over a tinted wall |
| `metal` | 28 | ribbed / corrugated steel siding |
| `brick` · `plate` | 20 · 20 | old trade and old housing · riveted laps and rivet lines |
| `timber` · `stone` | 18 · 16 | weathered board · coursed ashlar |
| `concrete` · `glass` | 14 · 13 | board-formed, tie holes · curtain wall, floor-plate striping |
| `stucco` · `tile` | 11 · 9 | render over whatever was there · glazed ceramic |
| `bale` · `brass` · `frost` · `chrome` | 5 · 5 · 4 · 4 | straw and fibre · gilt · etched glass · mirror |
| `lattice` · `struct` · `deco` · `pump` | 3 · 2 · 1 · 1 | see-through truss · structural steel · the Meridian · a fuel dispenser |

⚠ **`deco` is one key.** The art-deco surface in this city is `ty_meridian` and nothing else wears
it. That is a fact about the city rather than a limit of the format — see §2.4.

**MODERNITY.** `placeModern(place)` answers 0..1 and everything district-shaped in the derived kit
reads it: how likely a frontage is to carry neon, a ribbon of glazing, a lit roof armature, a corner
blade, a trade sign in Chinese. It is `BIOME_MODERN[biome]` plus an east–west term across Coldwater,
**−0.3 at the east end to +0.3 at the west**.

Between them they also decide `derivedStyle`, which is three words and drives what the kit hangs on a
building that nobody has hand-trimmed:

- **`works`** — `metal`, `plate`, `concrete`. Louvre banks, roller shutters, ducts, stacks.
- **`front`** — `glass`, `deco`, `brass`, or any model with an authored `neon`. Shopfronts, canopies,
  glazing ribbons, blades.
- **`block`** — `brick`, `stone`, `stucco`, `tile`, `timber`, `bale`, `window grid`. Window grids,
  fire escapes, cope.

⚠ **An authored `neon:` reclassifies a building.** `derivedStyle` reads it as a truth test — *somebody
gave this a lit frontage* — so putting an accent colour on a foundry turns it into a shopfront and
takes away its louvres, its shutters and its stacks. If you only want a COLOUR, leave `neon` off:
`accentOf` answers for all 173 models without it.

---

## 2. The quarters

⚠ **THE BUILT CITY IS ONE BIOME, AND THE GRADIENT IS DOING ALL THE SEPARATION.** This is the single
most useful thing on this page and it is invisible from the content side. Painting a district in
`content/` does **not** change how the renderer styles it today. Measured over the whole baked world:
of `BIOME_MODERN`'s eighteen rows, **ten are reachable and eight are not** — `uptown`, `marquee`,
`civic`, `docks`, `infra`, `freight`, `industrial` and `oldcoldwater` have **zero tiles**, and
essentially the whole built city is `citycore` (782 tiles). `HANZI_BIOMES` lists five biomes and only
`citycore` is among them, so the Chinese trade blade is on for the city and off for everything else,
rather than being rationed to a quarter the way its own note describes.

What separates the quarters in the picture today is therefore the east–west term and the palettes an
author chose. The gradient is real and worth authoring against:

| | tile | biome | modernity |
|---|---|---|---:|
| Aurelia, Voltage — the Glasshouse | 895,907–908 | `citycore` | **0.79** |
| The Cherry Pit — mid-west | 901,907 | `citycore` | 0.71 |
| Fisherman's Green — the centre | 909,911 | `park` | 0.42 |
| The Sump — east end | 921,914 | `citycore` | 0.42 |
| Old Coldwater — the south-east corner | 925,917 | `badlands` | **0.00** |

**West is glass and money. East is brick and work. The corner is neither.**

The district files in `content/districts/` are the content-side taxonomy and are a different SSOT —
see [land-taxonomy.md](land-taxonomy.md). **Sixteen of the twenty-two have tiles.** Twelve of those
are city: `halcyon_fields` 164, `docks` 64, `filaments` 47, `residential` 47, `yards` 39,
`commercial` 38, `marrow` 33, `glasshouse` 32, `ashway` 29, `slum` 27, `industrial` 23,
`nightlife` 20; the other four are ground rather than quarter (`wilds` 3,471, `water` 255, `sewer`
121, `wasteland` 71). Six have none at all — `civic`, `government`, `hazard`, `longwatch`,
`redline`, `slaglands` — which is a roster that was authored ahead of the map and has not caught up.

### 2.1 The Glasshouse — chrome, curtain glass, etched glass

The Ascendant quarter, the west shore, the most modern ground in the Basin. Nothing here was built
before the lights went out and it is not pretending otherwise.

**Palette.** `ty_hf_chrome` / `ty_hf_chrome_dk` / `ty_hf_ice` (clad panel), `ty_halcyon`,
`ty_hf_glass`, `ty_hft_glass` (curtain wall), and the two new families:

- **`chrome`** — `ty_volt_chrome`, `ty_volt_chrome_dk`, `ty_aur_chrome`, `ty_aur_chrome_dk`. A real
  mirror: the texture carries the WORLD the panel reflects, sky over ground with a hard line where
  they meet, and the BRDF is `metal: 0.88`. ⚠ **It is not `ty_hf_chrome`.** That key is in
  `PLAIN_WALL`, which is `metal: 0.00` with no environment term — a seamless clad panel, "the
  difference between chrome and pale stone". Pale stone's opposite is not a mirror.
- **`frost`** — `ty_volt_frost`, `ty_aur_frost`, `ty_aur_pearl`. Etched glass, lit from behind,
  barely dimmed at night because it is the one surface here whose light comes from inside.

**Form.** Slender, glazed, stepped forward at the pavement rather than set back all the way up.
Colonnades of slim lit piers. Deep oversailing bands — a fascia at eye level, a cornice at the top.
Curved elements are welcome and should be **small**: a corner oriel reads as a bay window, a tapering
cylinder with a lid reads as a lighthouse.

**Light.** Cyan and violet in the field, hot magenta as punctuation. Not sodium — that belongs to the
east.

**Worked examples**, and the only two authored models in the quarter:

- **Voltage** (`content/building_models/voltage.json`) — a chrome drum on a frosted-glass hall, with
  a lit stair core up one corner, a sign pylon carrying a hanzi blade, a roof gantry and two
  searchlights. Its note records why the tower is round and why the fins are on the flanks.
- **Aurelia** (`aurelia.json`) — a slender glazed shaft over a shopfront, with a fascia at eye level,
  a deep cornice, a set-back attic and one curved corner oriel. Its note records **two failed
  attempts**, which is the useful part: a stack of setbacks reads as an office, and a tapering drum
  with a cap on it reads as a lighthouse.

⚠ **AND THE QUARTER SOUTH OF IT IS NOT MADE OF EITHER OF THOSE.** Halcyon Fields — 69 building
tiles over thirteen silhouettes, the estate the Glasshouse is building into — faces its mass in
`ty_hf_chrome` [186,198,208], `ty_hf_ice` [218,230,238], `ty_hf_chrome_dk`, `ty_hf_deck` and
`ty_hf_slab`. **Every one of those is in `PLAIN_WALL`**, which is the trap the palette note above
is written about: flat fill, `metal: 0.00`, no environment term, no coursing and no window grid.
The `chrome` and `frost` families arrived with the Voltage and Aurelia rebuilds and reached five
authored models; not one Halcyon tile got them. So the quarter reads as pale render by day and is
carried entirely by its neon after dark.

⚠ **AND 85.4% OF ITS WALL AREA IS A FLAT-SHADED DRUM**, which is why that is not simply a palette
fix. Measured over the 23 arms in and around the quarter: 2,594 drum faces against 444 textured box
faces, **zero** `windowBay`/`windowGrid` calls and **zero** `neonBlade` calls. A drum's surface is
the `hfChrome`/`hfGlass` closure and nothing else — `drawFacetDrum` never reaches `wallTex`, shades
against a FIXED key direction rather than the sun, and marks its faces `flat`, so the GL material
pass skips them. And `derivedTrim`'s candidate loop is `if (sg.kind !== 'box' || sg.yaw) continue`,
so **a drum-mass building is invisible to the entire derived kit** — which is why `chrome_tower`,
`glass_prism`, `atrium_court`, `lens_hall` and `bead_tower` are five of the only ten models in the
whole 267-model registry with no trim at all.

⚠ **THE VARIETY WAS ALREADY THERE AND IT WAS THE WRONG AXIS.** Those ramps are not copy-pasted:
**133 calls over 69 distinct lo→hi pairs**, every one hand-picked. The quarter still read as one
white material because all 69 are the same HUE — 17–29% saturation at the dark end and **2–12% at
the light end** — and `hfChrome` raises the facet's light dot to a power ≥ 2, so most of every drum
sits at the light end, which is exactly where they are all the same near-white. The variation was
entirely in LIGHTNESS and it landed where nobody could see it. `RENDER_TUNE.hfTint` gives each TILE
one of eight casts off its own seed ([client/shared/hf-tint.js](../../client/shared/hf-tint.js)),
authored as an angle in the YIQ chroma plane so `dY` is zero by construction and the estate still
reads as one developer's cladding. Gated by `npm run gl:hftint`, mutation-tested 7 of 7. The boxes
are deliberately NOT tinted: a palette key is an atlas entry, and a per-tile variant on `texKey` is
the thing the GL power note forbids.

⚠ **A BOUTIQUE IS ITS FRONTAGE.** The lesson out of that rebuild generalises to the whole quarter:
when a shop does not read as a shop, the problem is almost never the trim, it is which part of the
building is in charge. Setbacks are what an office does because its floor plates shrink. A fascia
oversailing the glass is the single most recognisable thing a shop has.

⚠ **AND THE QUARTER IS NOT WHERE NEW DEVELOPMENT GOES.** Rebuilding a model on a tile that already
exists is welcome. Laying NEW tiles out here is not — see the standing note in the world docs: new
Coldwater development belongs on the central waterfront, because anything built beside the
Glasshouse arrives wearing Ascendant voice by proximity.

### 2.2 The Marquee and the nightlife strip — neon

Bars, clubs, casinos, the strip, the cinema and the arcade. `SIGN_TRADE` gives all of them the
`script` hand and the `martini` pictogram, and `PICTO_ACCENT` gives them **`#ff2e8e`** — the loudest
thing on the street.

**Rules.** A club marquee says who is on tonight, not its own name. Three signs at three distances is
right for a landmark and three copies of one word is a shop — see §3.1. The bottom of Meltwater Row
is the worked example of siting: a pool hall and an arcade facing each other with a cinema a tile
north and a bookmaker a street away make a *place*; the same four scattered across four districts
make four landmarks and no district.

### 2.3 Downtown — the citycore block

The default, and 86 palette keys' worth of it. Brick and stone, window grids, fire escapes, painted
wall ads. `MAT_FONT` gives brick and stucco the `block` hand (a wall ad, in the heaviest thing going)
and stone and tile the `slab` one.

⚠ **This is the bed the accents sit on, and it goes COLD.** `MAT_ACCENT` burns brick `#5fb4ff`, stone
`#7fc8ff` and the `window grid` default `#4fc8ff`. Measured before that table existed, 118 of 173
models burned red or amber and one shade of tungsten was on fifty-three of them — a third of the city
burning the same colour, at which point it is not an accent, it is the background.

### 2.4 Deco — the Meridian and its relatives

**One building wears the family.** `DECO_WALL` is `{ ty_meridian }`: bespoke art-deco limestone with
reeded vertical piers, tall paired windows and chevron spandrels, under a standing-seam copper crown
gone to verdigris (`SEAM_ROOF`, `ty_verdigris`). `brass` (`ty_meridian_bronze`, `ty_marble_bronze`,
`ty_dw_brass`, `ty_thumb_brass`, `ty_vig_trim`) is the gilt that goes with it, and `MAT_FONT` gives
both the `deco` hand — the inscriptional face, gilt on stone, a chiselled lintel.

**The style, as the building states it.** A deco tower ends in a crown rather than a lid; its
verticals gather into stepped capitals; its name is **cut into its own stonework** and nothing is hung
off it. `KIT_DECLINE` carries `meridian: ['signRoof']` for exactly that reason, and the hotel entry in
`SIGN_TRADE` deliberately carries no pictogram with the same note: *"a hotel of this vintage lettered
its stonework and hung nothing off it"*.

⚠ **`pilaster` with `cap: true` is the deco move and it is generic.** A rank of fins gathered into
stepped capitals is art deco's whole silhouette; the same part with `glow` set is the cyberpunk
skyline's. One part, two periods, and which one a building gets is read off axes that already exist.
A second deco building needs a palette key and that part, not a new mechanism.

**This quarter is one building deep.** If you want a deco *street*, the honest entry cost is a handful
of limestone and bronze keys in `DECO_WALL` / `BRASS_WALL` and a rule about which tiles get them.

### 2.5 The Yards and the works — industrial

`metal`, `plate`, `concrete`, `lattice`, `struct`, `bale`. Corrugated siding, riveted laps and rivet
lines, board-formed concrete with tie holes, open truss.

⚠ **INDUSTRY DOES NOT SIGN ITSELF.** `UNSIGNED_TRADE` holds power and utility, heavy industry and
processing, and freight, storage and yards — a shed with a number on the door. `NO_AD_TRADE` is the
tighter set that will not carry an advertisement either. A works that wants its name up says so with
`signWorks: true` on the model, which is the stated exception rather than a free choice.

⚠ **AND AMBER IS RESERVED, NOT RETIRED.** `MAT_ACCENT` keeps sodium for `metal`, `plate` and
`concrete`, and `PICTO_ACCENT` keeps `#ffa32e` for forecourts, garages and depots. That is what makes
the industrial east read as a different decade from the glass west **without one coordinate being
named anywhere in the renderer**. Spending amber on a shopfront spends the thing that separates them.

### 2.6 The waterfront

`docks` palettes, `ty_pier_steel`, `ty_pier_deck`, `ty_wharf`, the quay cranes and the berth. Painted
plant rather than coursed material: `ty_crane_body`, `ty_crane_cw`, `ty_crane_cab` are all `plain`,
because every other family here is a rhythm and a modern crane reads as painted steel.

The character is **industrial, not Ascendant**: rust, diesel, salt, sodium light, and no em dashes in
the prose. See the pier at 909–910 × 902–905 — Jetty Yard, the two pier decks, the two quay cranes
and The Beacon.

### 2.7 Old Coldwater — the Shingles

The slums in the south-east corner, and the poorest ground in the Basin at modernity **0.00**.
`SHAKE_ROOF` (`ty_oc_shake`) is split shakes laid in courses with a ragged butt line — the district is
named after them — over board-and-batten (`ty_oc_board`, `ty_oc_board_dk`, `timber`) and corrugated tin
(`ty_oc_tin`, `metal`).

⚠ **Nothing here is lit, and that is the point.** Two shopfronts in the whole city are genuinely dark
after six and both are down here: Stuff It's sign is PAINT (`bakeSignText` with `dn: 0`, measured at
0 grads and 0 blurs at full night) and Second Helpings needed `solid` as well, because the default
lays a white neon core over whatever ink you hand it.

⚠ **And a tent is a `mark`, never a `building_type`.** A building tile leaves the walk graph and joins
the CFIT collision sweep, so a tent city made of buildings is one you cannot walk into and can fly an
aircraft into. The ruins ARE buildings, for the mirror reason.

### 2.8 The Reach — frontier

Timber, boardwalks, hitching rails, split shakes (`ty_reach_shake`, `ty_reach_motel_roof`,
`ty_reach_bath_roof`), rust (`ty_reach_rust`). The `western` hand.

⚠ **The exemption is by ARM, never by palette.** `NO_TILE_FIT` lets the Reach, the Thornwarren and
Terminus keep boardwalks that cross their own plot line — but `laundromat`, `citybathhouse`,
`comicshop`, `bar` and `pawn` are Coldwater buildings wearing a frontier palette, and a prefix test
exempts all five by accident. Check the arm, not the key.

⚠ **And a frontier saloon is not in Chinatown.** `HANZI_BIOMES` exists so a trade word in Chinese
reads as a quarter somebody lives in rather than a texture somebody applied. Today that list only
ever matches `citycore` (§2), so the ration is doing less than it looks — do not put hanzi on a
porch-and-hitching-rail building just because nothing stops you.

### 2.9 Everything that is not Coldwater

Terminus, the Thornwarren, Deadwater and the Reach are regions rather than quarters and have their
own section — see §3. The one rule worth carrying across from here is the one that catches everybody:
**the Thornwarren's wall is grown, not built**, which is technically `building_type` and nothing
else, because `is_building` + `building_name` would put 62 tiles into the map-code namespace and
collide with Terminus's wall.

---

## 3. The regions, and the orders that own them

Coldwater is §2. Four more regions have ground — **the Scarletwastes** 4,869 tiles, **Deadwater**
4,839, **Terminus** 1,632 and **the Reach** 403 — and each has a palette prefix of its own.

⚠ **ALL FIVE CANONICAL ORDERS ALREADY HAVE GROUND, WHICH IS EASY TO GET WRONG BECAUSE THREE OF THE
REGIONS ARE NOT NAMED AFTER THE ORDER THAT LIVES IN THEM.** Deadwater is the Null's, the
Scarletwastes is the Wildblood's, and **Terminus is the Exodus's** — settlement, wall, sixteen
interiors and a launch pad, shipped 2026-08-18. What is missing is not land. It is that three of
those regions are currently faced in flat paint (§3.0), so the belief is in the prose and not yet on
the walls.

⚠ **THE COLOUR IS ALREADY AUTHORED, SO DO NOT PICK IT AGAIN.** Every order carries a `color` in
`content/orgs/ideology_*.json`, along with the two axes it is positioned by (`flags.authority`,
`flags.path`). A faction's accent, its lamp colour and its signage ink all come off that record. A
second copy in a model file is a second copy to keep in step — the same argument `$trade` makes for
the words.

| order | colour | stance · path | ground today |
|---|---|---|---|
| The Ascendants | `#4A90D9` | redeem · machine | the Glasshouse, Halcyon Fields — **built** |
| The Long Watch | `#E0A030` | redeem · human | Coldwater itself — **built**, and deliberately styleless (§3.5) |
| The Null | `#7E8A99` | renounce · machine | Deadwater — **built**, phases 1–2 |
| The Wildblood | `#6AB04C` | renounce · flesh | the Scarletwastes, the Thornwarren — **built** |
| The Exodus | `#9B59B6` | renounce · mind | **Terminus** — the whole region, wall and pad — **built** (§3.4) |
| Prometheans · Synthesis · Pioneers · Lucid | `#E8703A` · `#2EC4B6` · `#E0576B` · `#4FD1E0` | four gated expansion orders | **none**, and see §3.7 |

### ⚠ 3.0 Three regions are faced in flat colour, and that is the gap this section exists to close

Measured over the palette prefixes, by material family:

| prefix | keys | families |
|---|---:|---|
| `ty_reach_*` | 26 | **timber 15**, window grid 4, metal 4, plain 3 |
| `ty_oc_*` | 9 | timber 2, brick 2, window grid 2, plain 1, plate 1, metal 1 |
| `ty_dw_*` | 15 | **plain 9**, plate 2, stone 2, brass 1, stucco 1 |
| `ty_sw_*` | 29 | **plain 19**, tile 3, plate 2, brick 2, stucco 2, bale 1 |
| `ty_trm_*` | 38 | **plain 29**, concrete 3, stucco 3, tile 2, lattice 1 |

`plain` is the one family with no pattern at all — flat fill, no coursing, no grid, written for
soffits, kerbs and kiosk flanks. **Deadwater, the Scarletwastes and Terminus are each mostly made of
it**, so whatever their prose says, their walls currently carry no material read. `ty_trm_copper` is
`plain`; a copper wall is not flat paint.

⚠ **AND THE WORSE THE PROSE IS, THE MORE THIS COSTS.** Terminus is the best-written place in the
game — a poured-concrete pad with four lattice masts and an unfinished vehicle on gantries, inside a
wall with one gate — and twenty-nine of its thirty-eight keys are flat colour, so from the air it is
a beige compound. **These three regions do not need more content; they need their existing content
to be made of something.**

**The Reach is the counter-example and the proof that the approach works.** Fifteen of its
twenty-six keys are `timber`, and it is the one region outside Coldwater you can identify from the
air with the signage switched off.

Giving a region a style therefore starts with **families, not colours** — see §3.8.

### 3.1 The Ascendants — the Glasshouse and Halcyon Fields · built

§2.1 is the brief for the Glasshouse. **Halcyon Fields is the same order at quarter scale** — 164
tiles, the largest authored district in the city, 69 buildings after the third campaign — and its
own palette block states the rule better than anything else on this page:

> The palette is deliberately narrow — **four values of chrome and two of glass**, reused across
> every arm in the quarter.

That narrowness IS the style. Eight arms were added in one pass — `bead_tower` (six glazed bulges
threaded on a chrome spine, pinched to a collar between), `glass_prism` (six sides of tinted glass
drawn to an actual point), `lens_hall` (a glazed disc on six chrome legs), `chrome_arch` (two legs
that lean together and meet, with the road under them) — and every one of them is the same six
colours in a different geometry. A ninth value would have made the quarter a collection.

⚠ **The voice tell is punctuation.** Em dashes belong to Ascendant wire copy and to the Architect,
and to nothing else in the game. Worth knowing when you write a sign, a plaque or a placard here.

### 3.2 The Null — Deadwater · built ground, style half-written

**What they believe decides what they build, and here that is unusually literal.** The Null refuse
technology they cannot open: *"what they keep, they keep because they can build it, break it, and
mend it by hand"*, and their own prosthetic is an arm of cable and spring with a servicing card tied
to the wrist. So the architecture is **everything a maintainer needs to see**: riveted plate and
bolted flange, external fasteners, inspection hatches, gauges readable from outside, a chalked
column on a wall with a number at the bottom of it.

**The region already says it in the GROUND, which is the part to build up from.** 4,836 tiles of
`ash` outside — burnt grey waste that takes a print and keeps it — and `gravel` on the works
platform, graded hardstanding these people laid and go on maintaining. *The ground changes underfoot
at exactly the line where somebody started looking after it.* ⚠ And **nothing anywhere says what
burned, or when**: ash with an explanation attached is a backstory, ash without one is a place.

- **Families.** `plate` and `brass` are the identity; `stone` for what was here first.
  `ty_dw_forge` and `ty_dw_iron` are already `plate` and are the right instinct — the other nine
  of the fifteen keys are the gap.
- **Light.** Work-light sodium and oil flame, never neon. A tube they would have to maintain is a
  dependency, which is the one thing they will not own.
- **Signage.** Hand-lettered `stencil` or `mono`, painted straight onto the plate (`bare`). Never
  `script`, never `hanzi`, never a lit hoarding. Most of Deadwater belongs in `UNSIGNED_TRADE`.
- **Never** a revolving door, an automated shutter or anything that reads as sealed. **And no
  airfield** — the region deliberately has none.

⚠ **THEY ARE NOT A SCRAPYARD, which is the mistake this brief exists to prevent.** The Null
understand machines better than the people who worship them. The finish is plain and *exact* — square
work, clean welds, everything labelled — not improvised. A junkyard palette says the opposite of
their creed. Their own doc's rule 4 is the same thing in one word: **everything here is legible**,
which is the stated difference from the Thornwarren.

### 3.3 The Wildblood — the Scarletwastes and the Thornwarren · built

**Grown, not built.** The wall is thorn that closes when you cut it, and it is the deliberate
anti-Curtain. Hide, bone, canvas, fired clay, mud render, timber lashed rather than framed.

- **Families.** `bale`, `timber`, `stucco` (mud render) and `tile` (fired clay) — nineteen of the
  twenty-nine `ty_sw_*` keys are currently `plain` and should not be.
- **Light.** Fire. There is no electric light in this region and there should be none in the palette.
- **Signage.** None. No lettering at all — a trade word implies a trade counter.

⚠ **THE TERROR IS ON THE APPROACH AND THE INSIDE IS DOMESTIC, AND THE ARCHITECTURE HAS TO CARRY BOTH
WITHOUT REMARKING ON IT.** The trophy road is a performance whose tell is that it is *maintained*;
the gate masks are quilt-lined so they do not chafe on a long shift. So the buildings inside the wall
must read as **mended, swept, cared for** — a town somebody's grandmother lives in. Anything that
reads as a horror set is the costume mistake, and no NPC ever argues the point.

⚠ **AND THE WALL IS `building_type` AND NOTHING ELSE** — no `is_building`, no `building_name`. A
boundary is not a landmark: `bt` is what stops a truck and what the flight sim extrudes, while the
map's marker namespace keys off `is_building` and derives a code from the name, so 62 named wall
tiles would be 62 map codes. Terminus is the region that proved it (see §3.4).

### 3.4 The Exodus — Terminus · BUILT, launch pad included

**A launch complex nobody will confirm is a launch complex.** Between a departure gantry and a closed
order — and it is not a proposal, it shipped on 2026-08-18. The codex line is the whole brief:

> *"They are the only order whose stated goal is to leave, and the only one that will not tell you
> where to."*

⚠ **THE SETTLEMENT IS NOT CALLED EXODUS, AND THAT IS LOAD-BEARING.** *Exodus* is an ORDER, so the
void's `heading: 'Exodus'` reads as *the direction the Exodus went*. The place is **Terminus** — a
transit word meaning end-of-the-line, used by people who meant it as the last stop before somewhere
better. They were right about the first part. **The Reach is where you go to stop; Terminus is where
you go to keep going.**

**The compound.** A 40×40 region with a 19×19 wall ring, 72 wall tiles, **one gate**, and at the
exact centre of both compound and region:

> **The Ascension** — a hundred feet of poured concrete with four lattice masts around it and,
> between them on gantries, **the beginnings of something that has been the beginnings of something
> for a very long time**. The welds nearest the ground have been ground back and redone in a better
> hand than the ones at the top.

That last sentence is the best single line of style direction in the repo: the work is *old*, and it
is *getting better*. Anything added here should be able to say which end of it somebody did.

**There are two pads and the split is the design.** *The Gantry* sits on the apron outside the wall
for visitors and the trucker who drove 1,170 tiles; *The Ascension* is theirs. Both are `vtol_only`,
so both render the circle-H rather than a strip — **they were never building for aeroplanes.** ⚠ You
can land on the Ascension without being let through the gate, and that is deliberate: the wall is a
rule about the *road*, and what stops a stranger is the hall's own door, which does not open, and
nobody will tell them why.

**The sixteen interiors are the cult half, done without a single symbol.** Benches facing a floor
rather than an altar. Forty feet of table and neither end is the head. Sixty identical beds and one
book about tides. A bell with no rope. A stone basin of water that is not still. *"The blankets are
the same blanket. The pillows are the same pillow."* Repetition is the tell, and there is no sigil
anywhere in it.

- **Families.** `concrete` (board-formed, tie holes) for the apron, the pad and the wall; `stucco`
  for the quarters; `stone` for the Quiet Ground; `lattice` for the masts. **Not `chrome` and not
  `glass`** — that is the Ascendants. **Not `plate`** — that is the Null. ⚠ Twenty-nine of the
  thirty-eight `ty_trm_*` keys are `plain` today, which is the largest single style gap on this
  page: a compound this well written is currently painted in flat colour.
- **⚠ NO VISIBLE MECHANISM.** Their doors already look automatic and are not — they are being opened
  by the people walking through them (`registerLockType('psi')`: no keypad, no guard, nothing to
  hack or pick). Extend it. No hinges, no cables, no fuel lines, no plumbing. A launch structure with
  nothing feeding it is the same joke as the doors, at a hundred times the size.
- **Light.** Almost none, and never a sign. Violet (`#9B59B6`) is the rarest accent in the game —
  spent once, at the threshold, never on a facade. ⚠ **The Stillwell ships with no fixture, no switch
  and no lamp**, which is the one deliberate exception to *an interior that ships without power ships
  dark*: the only reason to build a windowless room with no light in it is that the people who use it
  do not need one.
- **Signage.** None. No name, no trade word, no pictogram. The personal glyph is on the PERSON.

⚠ **THE PURIFIER IS THE HINGE BETWEEN THE TWO POLES.** Before they let you in you submit to a machine
that strips every mutation and every augment out of you — it warns you once, it hurts for real, and
it never takes the fee and fails. It is **an airlock in everything but name**: you may not carry the
old world through. It is the chair in the Stillhouse, and it is already built.

⚠ **AND THE BEST JOKE IN THE REGION IS ONE NOBODY MENTIONS.** The plant moved inside the wall: the
trading post outside the gate, the diesel pump and the lamps all run off *the one machine these
people renounce*. **They power the thing they disapprove of and never once mention it.** Never write
the line that points at it.

⚠ **NEVER A TEMPLE, AN EYE MOTIF, A SIGIL OR A ROBED SILHOUETTE** — the stock occult costume explains
them, which is the one thing they must not do. **And never write a character explaining the creed**;
there is exactly one exception in the whole region and he has it because he touched the machine and
is not going with them.

### 3.5 The Long Watch — Coldwater · built, and styleless on purpose

They are the city, so their architecture is the city's: brick, stone, `window grid`, cold accents,
the downtown block of §2.3. **There is no Long Watch palette and there should not be one.** What is
theirs is what is **absent** — no chrome, no backlit hoarding, no sealed shell — which is the same
rule the discipline is built on: *a Long Watch veteran must not look supernatural on inspection.*

### ⚠ 3.5a And that is only true of the street. What they build for themselves is heavy industry

The paragraph above is about the buildings a Long Watch member walks past, not the ones they work in.
Above ground they wear the city. **Below it they have a material identity, and it is the loudest of
any order's**: the base rooms already shipped it without anybody naming it. Poured plate, salvaged
steel, hand-strung bulbs, rubber engine mounts, copper mesh, a foot-treadle lathe, rock wool packed
into a wall, forty tonnes of rigged fill over a corridor. Oil, flux, ink, scorched iron, onions.
Everything is made, repaired and labelled by hand, and everything shows the hand that did it.

**This is the deliberate opposite of the Ascendants and it reads at a glance.** The Glasshouse is a
sealed white shell that says nothing about its own mechanism. A Long Watch machine is the mechanism,
with the covers off, so somebody can fix it in the dark with the tools on the wall. Welds are visible
and the ones lower down are in a better hand than the ones on top. Nothing is finished, because
finished means nobody can get into it.

⚠ **The purity rule is about the BODY, and the gear is the whole point of that distinction.** They
refuse chrome under the skin and build hulking powered things they climb into and out of: exosuits,
walking rigs, plate you bolt on, weapons far past what a person should be carrying. A frame you can
step out of at the end of a shift isn't an augment, it's a tool, and the Watch will argue that at
length with anybody who wants to hear it. The line is that **nothing is permanent and nothing is
yours alone** — a rig is signed out of the quartermaster's ledger, cleaned, and signed back in.
That is also why none of it may ever grant a permanent passive: same founding rule as the discipline.

⚠ **None of it is networked, and that constrains the whole catalogue.** Iron sights, film cameras,
wind-up timers, hand cranks, foot treadles, paper. A Watch rig has levers and a lot of them; it has no
screen, no assist and no smart anything, because a thing that phones home is a thing the Architect can
hear. If a part needs the grid to run, they don't have it — see the Generator Vault, which draws
not a watt, ever.

⚠ **And it can never be SEEN in Coldwater.** An operation that leaves the Watch visible has failed,
so a walking rig is a thing of the Under, of a sally port at night, and of the day they surface. The
tension is the feature: they have built the heaviest hardware in the Basin and their own creed forbids
them using most of it yet. It waits in the Cache with everything else.

### 3.6 The Reach, and Old Coldwater

Both are covered in §2.7 and §2.8, and both are inside this section's own point: they are the two
places outside the core with a real material identity, and they got it from families rather than from
colours. The Reach is also the other half of Terminus's sentence — **where you go to stop.**

### 3.7 The four gated orders — DESIGN, and not yet

`ideology_prometheans`, `ideology_synthesis`, `ideology_pioneers` and `ideology_lucid` carry
`flags.expansion: true`: preview-only, and they never win the lean. **None of them should be given
ground while that is true** — a region is the loudest thing an order can have, and a faction with a
map and no mechanics reads as content that was abandoned rather than content that is coming.

When they arrive, the one that needs the most care is the **Prometheans**: redeem · machine puts them
in the cell next door to the Ascendants, and *"technology belongs to humanity, not to the Architect"*
against *"humanity's next evolution will be engineered"* is a difference a player has to be able to
SEE. The honest reading is licensed versus opened — the Ascendant shell is sealed, white and
finished; a Promethean building is the same hardware with the covers off and somebody's own
improvements bolted to it. That is close to the Null and must not collapse into them: **the Null took
the machine out, the Prometheans took it apart and kept it.**

### 3.8 How to give a region a style

1. **Families first.** Pick two or three from the twenty and let them carry the identity. A region
   that is mostly `plain` has no style however many keys it has.
2. **One key per real surface, filed correctly.** A copper wall goes in `brass` or `metal`; a fired
   clay one in `tile`. `plain` is for things that genuinely have no pattern.
3. **The accent comes off the order's `color`.** Do not pick a second one.
4. **Decide whether they sign at all**, then pick the hand — `MAT_FONT` will answer by material if
   the trade table does not, and `UNSIGNED_TRADE` is how a building says it does not advertise.
5. **Then the parts.** Silhouette before trim (§4.4).

## 4. Rules that cross every quarter

### 4.1 One building, one name

⚠ What makes a busy frontage read is not how many signs it carries but that they say **different
things**. One Coney Island corner says the name, then DELICATESSEN, then CLAM BAR, then SEA FOOD —
three boards all repeating CASH & CARRION would look worse than one.

A building gets its NAME once. Any second fitting takes the trade word through the **`$trade`** label
sentinel, which resolves out of `SIGN_HANZI` / `SIGN_WORD` on `tradeOf(m)`; the **hand picks the
language**, so `font: 'hanzi'` gets 夜總會 / 時裝 and anything else gets the English word. Never type
the word into a model file — that is a second copy of a table that already exists.

⚠ `$trade` is not `$name`'s twin for caching. `$name` varies per TILE and can never be captured into a
per-model mesh, which is what `perTile` guards at all three call sites; a trade word is a property of
the MODEL and captures like any other authored string.

### 4.2 Blue is the field, pink is the punctuation

The generic facade goes cool. Hot magenta is spent on the trades that earn it — the bars, the clubs,
the casinos, the places that are open because it is dark. Make the 53-model default magenta and a
third of the city is hot pink, at which point it has stopped being an accent.

### 4.3 A building has four sides

Before the flank kit existed, trim area over wall area measured **front 54% · left flank 21% · right
flank 9.5% · back 0.5%**, with 174 of 227 models under 2% on the back — a city of buildings with a
facade and three blank elevations. It is **front 57.9% · back 23.3% · left 27.3% · right 30.0%**
today over 265 models (`npm run models:elevation`, which is where to re-read these rather than
trusting this line).

And the back is not only seen from the air: of the 342 building elevations in Coldwater that face an
actual road tile, **58.5% are a front and the other 41.5% are a flank (19.3%), a back (13.2%) or a
tile with no entrance recorded at all (9.1%)**.

⚠ A pier rank is not "facade on a flank". No shopfront, no awning, no name board, no glazing — every
one of those is derived from the ENTRANCE, and a building has one of those. A pier is the structure
showing, which is why a warehouse flank, a party wall and a shed all have them.

### 4.4 Say it in the silhouette before you say it in the trim

A flat wall wearing forty greebles is a flat wall. The parts that change what a building IS are the
four structural kinds — `windowBay`, `canopy`, `signGantry` / `bladePanel`, `pilaster` — plus the mass
itself. Reach for those before you reach for another vent.

---

## 5. How to check yourself

None of this is enforced by taste. The gates that will tell you when a style decision has gone wrong:

| | asks |
|---|---|
| `npm run models:quality` | a roof face, a light at night, more than one wall palette, any trim — out of four |
| `npm run models:elevation` | does every side of this building carry something |
| `node scripts/shapes/anchored.mjs` | is every part bolted to a wall that exists |
| `npm run sign:stand` / `signband` | is the name on its wall, and on clear wall |
| `npm run sign:fit` | is anything drawn across the lettering |
| `npm run sign:hand` | did each mark keep its own hand among its neighbours |
| `npm run gl:mat` | does every palette key resolve to a family in range |
| `npm run gl:self` | is any adornment pulled out in front of its own mass |

And the picture: `npm run modelshop` (:5181). ⚠ **Use the Cab preset.** `ADORN_NEAR` detail exists for
a driver at eye height 0 and a cockpit almost never sees it, so authoring only from a cockpit is how
near-tier detail ships broken.
