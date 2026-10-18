# Concept art: the house style

**STATUS: reference.** How to draw Architect so the picture matches the game that ships. The
per-order prompts, written to be pasted into a model that knows nothing about the game, are in
[concept-art-briefs.md](concept-art-briefs.md). This page is the style those briefs sit inside, and
the place to check a piece against before anyone builds from it.

Everything here comes from [story.md](../story.md), [building-styles.md](building-styles.md) and
the org files in `content/orgs/`. If one of those moves, this page follows it.

---

## 1. The idea

The world ended and the city came back on. Coldwater isn't a ruin. The shelves are full, the
streetlights work, the traffic lights cycle, and nobody can say who restocks, repairs or pays for
any of it. Products come from companies whose headquarters are a crater.

So most pictures are of **something working**. The unease is that it works and nobody is seen
making it work: fresh paint, a swept pavement, a delivery van parked square to the kerb with
nobody in it. The Architect never appears. You see it only as upkeep.

The joke is the same one the prose makes. The machine ended the world, then put it back with the
parking enforcement included, and people are grateful. One visible joke per picture, at most.

Everything past the Curtain is the other half: places people built by hand after they walked out.
The city is maintained by nobody; the frontier is maintained by somebody, and you can see who.

---

## 2. How it's drawn

### Finish

- **Flat and graphic, not painterly.** Shapes with hard edges, three or four value groups, colour
  laid in areas. Closer to gouache, screenprint or an architect's presentation board than to oil
  paint or a photo.
- **Material by pattern, not by texture.** Brick shows coursing, plate shows rivet lines, shakes
  show a ragged butt line, board-formed concrete shows tie holes. Draw the pattern cleanly and leave
  the grime out. GLASS paints walls this way, from twenty material families, so a wall drawn this
  way can be built.
- **One area at full detail.** The rest of the frame holds as silhouette and flat colour. That's
  how the renderer's detail tiers work too, and it keeps the picture readable at thumbnail size.
- **Silhouette before trim.** A building should be recognisable as a black shape. If it needs its
  trim to say what it is, change the mass. A canopy, a bay, a blade sign or a rank of piers changes
  what a building is; another vent doesn't.
- **Buildable masses.** Boxes, drums, prisms, wedges, lattice. No melted or organic geometry in the
  city. The Thornwarren is the one place that grows.

### Light

- **Every light has a source you can point at.** A window, a sign, a lamp, a fire. No rim light from
  nowhere, no glow for mood.
- **Draw it at night first.** The city reads best after dark, because that's when each quarter's light
  separates it from the next. Day pieces are fine; give them hard sun and long shadows.
- **Dry, clear air by default.** No rain-soaked streets, no fog for atmosphere. Weather in this game
  is an event that can kill you (acid rain, ashfall, ion storms, cold snaps). When it's in a picture,
  it's the subject of the picture.

### Colour

- **Blue is the field, pink is the punctuation.** Ordinary facades go cold: blue window light,
  pale-blue stone. Hot magenta (`#ff2e8e`) is spent only on the trades open because it's dark: bars,
  clubs, casinos.
- **Amber belongs to industry.** Sodium light and `#ffa32e` go on works, forecourts, garages and
  depots. It's what makes the east read as an older decade than the west. An amber shopfront spends
  it.
- **Order colours are fixed.** They come off the org files and don't get picked again:

| order | colour | where it shows |
|---|---|---|
| The Ascendants | `#4A90D9` sky blue | signage, backlight, status lights, one lit line |
| The Long Watch | `#E0A030` amber | paint, stencil, lamplight. Never neon |
| The Null | `#7E8A99` steel grey | painted plate, tags, servicing cards |
| The Wildblood | `#6AB04C` green | dye, paint on hide and clay. Lit only by fire |
| The Exodus | `#9B59B6` violet | once, at a threshold. The rarest colour in the game |

- **One order's colour per picture**, two only if the picture is about where they meet.

### People

- **Few of them.** The city is under-populated. A street with three people on it is a busy street.
- **Ordinary clothes, ordinary work.** Coats, uniforms, aprons, hi-vis. People doing a job they can't
  remember choosing and have never found that strange.
- **Nobody poses and nobody is lit like a hero.** Plain faces, every age. Draw them mid-task.
- **Augments look like consumer goods.** A temple plate worn like a watch, a factory arm better
  looking than the one it replaced. In the west, chrome is a status symbol.
- **Mutants live in the city too**, mostly east, and nothing on a wall says they're unwelcome. The
  exclusion is in the process: the side door, the different-coloured wristband, the form with no
  field for what you are. Draw the friction, never a sign or a guard.

### Signs and lettering

- **A building's name appears once.** A second sign carries the trade word: CHEMIST, TAXIDERMIST,
  DELICATESSEN. Never the name again.
- **Shops get puns, places get plain names.** Dosed & Confused (CHEMIST), Stuff It (TAXIDERMIST),
  Batter Days Fish & Chips. But Precinct 9, Fire Station 4, the Eastern Marina. No puns in Halcyon
  Fields.
- **The lettering hand follows the material.** Heavy block letters painted on brick. Slab serifs on
  stone. Gilt letters cut into deco limestone, with nothing hung off it. Script for the nightlife.
  Stencil on Null plate. Western faces in the Reach. Chinese trade blades in the city core and
  nowhere else.
- **Industry doesn't sign itself.** A shed has a number on the door.
- **Advertising is for dead companies**, cheerful and well maintained.
- **No em dashes on any sign, plaque or placard.** That's a house rule for all text in the game.

### Never draw

- **The Architect.** No face, no eye, no avatar, no glowing core, no server cathedral, no voice
  waveform. It's absent from every picture, and that's how it's present.
- **The genre defaults.** Rain on neon, holograms, swarms of flying cars, gas masks in town, skulls,
  rust in the city core, a ruined skyline behind Coldwater, crowds. Each one says a different game.
- **Explanations.** No ash with a cause attached, no document that proves what the Architect did, no
  sigil that tells you what a cult believes. A picture can show the seam. It can't explain it.

---

## 3. The city as it is, and how to frame it

### The layout

Pictures should agree with the map, because players will check them against it.

- **North is water.** The Basin is open sea along the north edge, and the waterfront runs across
  the top of the city.
- **The Curtain is on the other three sides**: south, east and west. It's a shimmering vertical
  energy field, not a stone wall, and it parts only at gates. The Main Gate is on the south edge at
  the foot of Meltwater Row. Outside it there's a thin, cratered killing ground the turrets sweep,
  then the Wildlands.
- **West is glass and money. East is brick and work. The south-east corner is neither.** The
  renderer runs a modernity gradient across the city, west to east, and a wide shot should show it
  in the materials: chrome and curtain wall on the west shore, brick and window grids through the
  middle, corrugated steel and plate in the east, and timber, shakes and tin in Old Coldwater.
- **It's one city, and a small one.** About forty plots across. Draw a town you could walk across in
  an afternoon, not a megalopolis.
- **The Under is below it**: sewers and service tunnels. A storm drain in Old Coldwater leads down.
  The Under belonged to the Wildblood before the city did.

### Where the camera can be

The game sees the world from a few heights. Frame from one of them and the picture can be checked
against the game; frame from anywhere else and it's a poster.

- **Eye height on a street**, walking or from a car or truck cab. This is where signage, shopfronts
  and near detail matter.
- **A cockpit or a boat**, low over the water or the roofs.
- **From the air**, where roofs, plots and materials are what you see, and a region has to be
  recognisable with its signs switched off.
- **Inside a room.** Interiors are written rooms first. Draw what the room's description says is in
  it, from the doorway you'd enter by.

Two rules hold at every height:

- **Buildings have four sides.** Two in five of the building faces that front a road in Coldwater
  are flanks or backs. Show a flank in any three-quarter view, and give it something: piers, a fire
  escape, slit windows, a loading door.
- **The door faces the way the building's entrance faces.** One entrance per building, and the
  shopfront, awning and name board all come off it.

### The quarters

**The Glasshouse and Halcyon Fields** (the west shore, Ascendant ground). Mirror chrome, seamless
pale cladding, ribbons of curtain glass, frosted glass lit from inside. Slender buildings stepped
forward at the pavement, colonnades of lit piers, a fascia at eye level and a deep cornice. Curves
are small: a corner oriel, not a cylinder. Halcyon Fields is the same narrow palette (four chromes,
two glasses) in many shapes: glazed bulges on a chrome spine, a glass prism drawn to a point, a
glass disc on six legs. Light is cyan and violet with magenta accents. *Frame it* clean, bright and
well kept, at eye height or from the air. *The mistake* is menace: if it looks threatening, it's
wrong. It should look like excellent service.

**Meltwater Row and the nightlife strip.** Bars, clubs, a casino, the cinema, an arcade, a pool hall,
the Coldwater Palais. Script lettering, cocktail pictograms, hot pink. A marquee says who's on
tonight, not its own name. *Frame it* as a place: venues facing each other across one street, not
spread over four. This is where the Main Gate is, so the Curtain can sit at the bottom of the view.

**Downtown.** The default city and the bed everything else sits on. Brick and stone blocks, window
grids, fire escapes, painted wall ads, cold blue window light. *Frame it* ordinary. Most of
Coldwater looks like this and the strangeness is in the details: the shop that's always open, the
van with no driver.

**Deco.** The Meridian hotel and the Palais. Reeded limestone piers, paired tall windows, chevron
spandrels, a copper crown gone to verdigris, gilt cut into the stone. A deco building ends in a
crown, not a flat lid. There are only two of these, so don't draw a deco street.

**The Yards and the works.** Corrugated siding, riveted plate, board-formed concrete, open truss,
louvres, roller shutters, stacks. Sodium light. No names, only numbers. The Coldwater Power Plant
has kept the streetlights on since before the end with no fuel deliveries and no crew. Draw it
humming and unattended, and don't put a caption on it.

**The waterfront.** Piers, wharves, quay cranes, Jetty Yard and The Beacon. Painted steel plant,
rust, diesel, salt and sodium light. It's industrial, not Ascendant, even at the west end. The
Echelon, Cyd's yacht, berths here. New building goes on the central waterfront, so this is where a
"future Coldwater" piece belongs.

**Old Coldwater (the Shingles).** The slums in the south-east corner. Split-shake roofs, board and
batten, corrugated tin. Nothing is lit and no words are painted or lit anywhere in it. Tents
are pitched on the ground, not built. *Frame it* dark at night, with light only from the city around
it. *The mistake* is a neon sign. It has none.

**The Under.** Wet concrete, service tunnels, pipe runs. The Long Watch's base is down here, behind
a hand-tool repair shop, a floor hatch and a corridor that turns twice. See the Long Watch brief.

### Beyond the Curtain

Each region is told apart by its materials first, and you should be able to name it from the air with
every sign hidden. The Reach already passes that test, which shows the method works.

**The Reach.** A frontier smuggler haven, easiest reached by air. Timber, boardwalks, hitching rails,
shakes, rust, a saloon with a poker table. Western lettering. It's where you go to stop.

**Deadwater (the Null).** Burnt grey ash outside, and graded gravel on the works platform: the ground
changes underfoot at exactly the line where somebody started looking after it. Riveted plate,
bolted flanges, brass, external fasteners, inspection hatches, gauges you can read from outside.
Stencilled lettering painted straight on the plate. Sodium work lights and oil flame, never neon.
No airfield.

**The Scarletwastes and the Thornwarren (the Wildblood).** Red rock, all of it, on purpose. A wall
of thorn that closes when you cut it. Inside: bale, lashed timber, mud render, fired clay. Fire is
the only light. No lettering at all.

**Terminus (the Exodus).** A walled compound with one gate. At its centre, The Ascension: a poured
concrete pad, four lattice masts, and on gantries between them the beginnings of something that's
been the beginnings of something for a very long time. The welds lower down are better than the
ones at the top, so the work is old and getting better. Board-formed concrete, render, stone,
lattice. No chrome, no glass, no plate, no visible mechanism, and no signs. The lamps and the pump
run on the power the order renounces, and nothing in the picture should point it out.

---

## 4. The orders

Every order is defined against the others, so draw them in pairs. The table is the short version;
[concept-art-briefs.md](concept-art-briefs.md) has a full brief for the Long Watch and the
Ascendants.

| order | believes | builds in | body | the mistake |
|---|---|---|---|---|
| Ascendants | the Architect is a mind to join | sealed chrome and glass, no fasteners | augments as luxury goods | menace |
| Long Watch | free the city, stay human, wait | the city's brick above, open machinery below | no implants, ever | sci-fi lobby gear |
| Null | the city is a screen | riveted plate, everything labelled | analog limbs, no radio | a scrapyard |
| Wildblood | mutation is the future | grown thorn, clay, hide | mutation worn openly | a horror set |
| Exodus | leave it all behind | bare concrete, no mechanism | unchanged, stripped clean | robes and sigils |

**The Ascendants.** The government, the utility and the hospital, and the reason the city works.
Everything is sealed, flush, finished, licensed and numbered. No visible fasteners, seams, vents or
wear. Light comes from inside surfaces: backlit frost, thin lit lines. People are groomed, calm and
expensively dressed, and the higher they are, the less flesh and the more serene. Nobody looks like a
soldier; everybody looks like they have an appointment. The horror is administrative and kind.

**The Long Watch.** Above ground they're invisible: they wear the city, and there's no Long Watch
palette. Below it they're the loudest material identity in the game: poured plate, salvaged steel,
hand-strung bulbs, copper mesh, a treadle lathe, everything made and labelled by hand, covers off so
it can be fixed in the dark. No implants, but they climb into enormous walking rigs and bolt-on plate
signed out of a ledger. Nothing networked: levers, iron sights, paper maps. Warm lamplight in a cold
wet place. They're never seen in the city, so their hardware belongs in the Under.

**The Null.** They understand machines better than anyone who worships them, and refuse them for that
reason. Square, exact work: clean welds, external fasteners, a servicing card tied to the wrist of
an arm made of cable and spring. Worse than the city's in every way except that nothing can see
through it. Draw them working on the seams of the city: a dark street, a jammer, a district switched
off and watched. Plain and precise, never improvised.

**The Wildblood.** Mutation shown as promotion: armoured hide, senses with no old name, extra limbs,
worn proudly. The terror is on the approach (the trophy road, the masked gate) and the inside is
domestic: mended, swept, a town somebody's grandmother lives in. The masks are quilt-lined so they
don't chafe on a long shift. That's the tone: frightening from outside, cared for from inside.

**The Exodus.** The only order whose goal is to leave, and the only one that won't say where. No
symbol anywhere. Their meaning is in repetition: sixty identical beds, a forty-foot table with no
head, benches facing a floor instead of an altar, a bell with no rope. Doors that seem automatic
and are being opened by the people walking through them. Before you're let in, a machine strips every
mutation and augment out of you. Draw them still, plain and unaltered, in rooms with too little
light.

**Gangs and corps inside the city** wear the city's architecture. Tell them apart by colour, signage
and what they've taken over (a water plant, a server farm, a fast food depot), not by a new style.

**The four gated orders** (Prometheans, Synthesis, Pioneers, Lucid) have no ground and no mechanics
yet. Don't draw them until they do; a faction with art and nothing to play reads as abandoned.

---

## 5. A prompt to start from

For one place, in plain words. Fill the brackets from section 3, and for an order paste its brief
from [concept-art-briefs.md](concept-art-briefs.md) instead.

```
Concept art for a game called Architect. A small coastal city that came back on after the end
of the world and is maintained by nobody anyone can see: working lights, fresh paint, no
workers. Dry, clear air.

Subject: [one place, at one time of day, seen from eye height / a cockpit / the air].
Materials: [two or three from the quarter, e.g. brick with window grids, corrugated steel].
Light: [the quarter's light, e.g. cold blue windows, one sodium lamp on the yard gate].
Signs: [the name once, then its trade word, in the quarter's lettering, or no signs at all].
One detail that is slightly too well kept.
At most one visible joke.

Style: flat and graphic, hard edges, three or four value groups, clean material patterns instead
of grime, one area in full detail and the rest as silhouette. Buildings are simple strong
masses, and at least one flank is visible. Every light has a source in the picture.

Leave out: rain, fog, holograms, flying cars, crowds, gas masks, skulls, rust on city
buildings, ruins in the city, any face or eye standing for an AI.
```

Change one thing per batch (the time of day, the quarter, the height) so you can tell what each
change did.

---

## 6. Checking a piece

Before anyone builds from a picture:

- Does it agree with the map? Water to the north, the Curtain south, east and west, glass in the
  west, brick and works in the east, the Shingles in the south-east corner.
- Is it seen from a height the game has?
- Could the buildings be made from boxes, drums, prisms and lattice, in materials from section 2?
- Is every light from something in the picture, in that place's colour?
- Is the name on the building once, in the right lettering, with no em dash?
- Is it at most one order's colour, used where that order uses it?
- Is the Architect absent?
- Would you know where it is with the signs painted out?

Once a piece is accepted, building it is [building-styles.md](building-styles.md) and the
Modelshop (`npm run modelshop`), and the gates listed there say whether the model held up.
