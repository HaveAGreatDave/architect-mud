# Coldwater Streets

**Status: phases 1 to 3 built behind `RENDER_TUNE.streetKit` (off, until David approves the look);
phase 5 and part of phase 4 built behind `STREET_SYSTEMS` (off); the rest of phase 4 waits on design.** The brief is a Claude Doc, [Coldwater Streets: Build Brief](https://claude.ai/artifact/SFfx5RrSMryJPwM25HmDBB),
with the [3D preview](https://claude.ai/artifact/Ec21rXU2QigfBvrkXZKUd1) as the visual reference. This
file records what's built and the decisions taken on 2026-11-03.

## What it is

One street design for Coldwater, built from a kit: a 4 m licensed lane between two 5.6 m
walkways raised 0.18 m, with a metered strip down each walkway, bollards, a paid crossing, a public
footbridge, a respawn kiosk, planters and vents. Five condition levels step down from the core to the
dirt of Old Coldwater, and four bridges stack over the street by class.

| Phase | Contains | State |
|---|---|---|
| 1 | The kit at the core level, and the people walking round it | Built, flag off |
| 2 | Footbridge 7 m | Built, flag off |
| 2 | Service bridge 9 and 16 m, skybridge 12.5 m, executive bridge 24 m | Built, flag off |
| 3 | The comic-ink pass and the other four condition levels | Built, flag off |
| 4 | Metered strips, the kiosk's anchor, passing vehicles | Built, switch off |
| 4 | Paid crossings, the licensed lane, cameras, the drone | Design, see the questions below |
| 5 | Room text in each zone's voice | Built, switch off |

## Decisions (David, 2026-11-03)

- **Condition comes from the district.** `districts.street_condition`: 0 core (the Glasshouse, Halcyon
  Fields), 1 middle ring (Hawker's Row, the Marquee, the Marrow, the Filaments, the Civic Center), 2 worn
  (Nine Elms, Ironside, the Yards, the Docks), 3 unmaintained (the Ashway), 4 dirt (Old Coldwater).
- **Prices are whole credits.** ₵1 a strip ride, ₵2 to cross, ₵40 at the kiosk. Never "CR".
- **The dirt corner is free.** Old Coldwater carries no words, so there's nowhere to post a price.
- **The kiosk sells the anchor.** Death is already free; ₵40 makes the kiosk the place you wake.
- **The lane is licensed, not closed.** Trucks already drive the city. A rig bought at the depot
  comes with its licence; somebody on foot standing in the lane is billed.
- **A block is the tiles between two junctions**, not a fixed 100 m.
- **Chrome only in the core and the middle ring.** The Long Watch rule keeps it off their streets;
  from Worn down the same kit is steel plate and concrete.
- **Built on the road data that exists**, beside what ships, behind a flag until David approves the look.
- **The street is infrastructure, not clutter** (David, same day). Everything along it stands below a
  cab's eye or out at the frontage, the small parts are drawn near to only, and over the lane there is
  the crossing's arm and the footbridge and nothing else. The brief's other three bridges are read as
  part of that exception, being phase 2 of the same brief. Its overhead cables aren't, so they stay out.

## As built

**The parts** are in [glass/street-kit.js](../../client/game/js/panels/glass/street-kit.js), with no
renderer imports, as the Media Lot's are. `drawStreetKitPass` in windshield.js finds the tiles and
hands each one a face, light and lettering sink. On GL the faces go to `BAY_SINK` unshaded with a normal
and a material and the static part is kept (`markKept`), so it needs `marksGPU`. GLASS 1 draws no kit.

**Which tiles.** A road tile whose painted district sets a condition: the server ships it as `sc` on the
surface cell (`deriveSurfaceCell` in plugins/flight/state.js). ⚠ It reads the painted
`flags.district` only, never `districtFor`'s fallback: an unpainted tile anywhere falls back to the
Residential Blocks, and the kit would follow it into every region. Curved, marked and building tiles
take no kit, and neither does a road two or more tiles wide, because the 15.2 m cross-section is one
tile (17.857 m). A dust road takes it only at the dirt level. That's 247 tiles: 121 core, 56 middle,
45 worn and 25 unmaintained.

⚠ **Nothing in Old Coldwater is a road.** Its lanes are `dirt` terrain and `sc` is only set on a road, so
the dirt level has no tiles today. It's built and tested, and it's what a road painted into that
district would get. The lanes there already look the way the ladder asks.

**Where a block's parts stand** is `kitPlace`, worked out once per cell and read by both the paint and
the people: a toll gate at each end, the paid crossing on the middle tile, the footbridge on the last
tile of a block of two or more (6.5 m short of the junction), a kiosk at the start on the west or north
side and one at the end on the other side. A block is paved or dirt, never both, so a run stops at the
line between them, and the dirt has no crossing or footbridge. **What repeats** (bollards every 2.5 m, planters every 15 m,
vents every 17 m, guide dashes every 4.7 m, service pips every 5 m) is spaced from the tile's world
coordinate along the street, so a run carries on across tiles and doesn't move when the window
recentres.

**The ground underneath.** Where the kit draws, `drawGroundSurfaces` lays no pavement, kerb, lane
paint or crossing of its own (`streetKitShown`). The old pavement stands at `kerbHeight` (0.5 m),
above the kit's 0.18 m walkway, and covered half of it; the old centreline showed through the kit's
lane. A straight tile is still marked in `RAISED_WALK`.

### The parts

| Part | What it is |
|---|---|
| Walkway | A dark slab with chrome panels on it, two ink bands across each; one panel in sixteen is a duller inspection hatch with four bolts and a cyan pip |
| Kerb | A steel cap along the lane edge with a cyan light set into the face the lane sees, and a drain slot with grate bars in the lane at its foot |
| Lane | Matte near-black, a cyan guide dash down the middle, an edge line inside each drain, and LICENSED stencilled across it at each end of the block. ⚠ It stands 0.07 m up, above `ROAD_EPS`: at 0.03 m it sat under the road it covers |
| Metered strip | A belt in a steel housing with amber lights along it, chevrons the way it runs. The belt on your right carries you forward. Near to the chevrons move, at 1.4 m/s in the core and 0.45 in the middle ring |
| Toll gate | Two posts with amber caps either side of each strip, a hazard comb plate across the belt, ₵1 A RIDE over it on both faces |
| Bollard | Octagonal, 0.95 m, on a base plate, a cyan ring near the top and a red sensor eye on the lane side; a gap of at least 5 m at the crossing |
| Planter | A steel box on a plinth with a lit rim, a trunk and a low-poly crown, and a bench along its strip side |
| Vent, service channel | A grate in the walkway, one in two of them steaming; dark lids along the frontage edge with a cyan status pip every 5 m |
| Paid crossing | An amber zebra, studded tactile pads where it meets each kerb, a pole each side with an arm over the lane, a blinking amber head and ₵2 · CROSS |
| Footbridge | An open steel lift tower at the frontage edge of each walkway, glazed only at the back, with a car running a 20 s round; a deck 7.0 m clear of the lane, glass rails, an arched truss over each edge, a cyan line underneath, FREE CROSSING · CLEARANCE 7.0 M on both fascias, a camera hung off each side clear of the lane |
| Kiosk | A booth on a plinth with a canopy and a lit edge over the screen (RESPAWN / ₵40 / WAKE HERE) and a magenta strip down one side |
| Corner | A 1.0 m guard rail along each kerb for 4 m out of a junction, with a cyan line along the top |

⚠ **The lift towers are open frames on purpose.** The faces are opaque, so a tower glazed all round
drew as a grey box that hid its own car and anybody riding it.

**Three tiers by distance** (`near` under 6 tiles, the middle under 14, `far` beyond), in the kept key.
A straight tile is about 1,250 faces near, 440 in the middle and 180 far; a footbridge tile 1,700, 760
and 510; an upper bridge tile 1,500 to 1,600, 470 to 660 and 200 to 270. The damage takes faces away
rather than adding them: an Unmaintained tile is 1,075, 390 and 130. Far off only the walkways, kerbs,
lane paint, strips, trees, crossings and bridges are drawn.

### The upper bridges

[glass/street-kit-spans.js](../../client/game/js/panels/glass/street-kit-spans.js). The footbridge belongs
to the street; these belong to the buildings either side of it, so `kitPlace` reads the flanks.

| Bridge | Underside | Lands in | What it is |
|---|---|---|---|
| Service | 9 and 16 m | 6 storeys | Two dark steel decks, a lattice down each side, amber lights along every edge, a rail on the upper deck |
| Skybridge | 12.5 m | 6 storeys | A glass tube on a thin deck, a lit ring every 1.4 m, a gold line under it, four riders pacing inside, a camera |
| Executive | 24 m | 9 storeys | A dark box glazed in gold, angled steel fins under it, EXECUTIVE LEVEL · BY INVITATION on both fascias, two cameras |

**Where.** Each block has one of each at most. Dearest first, each class wants a place along the block
(service near the start, then the skybridge, then the executive) and takes the nearest free tile
with both flanks tall enough. They cross a tile north or west of its centre, clear of the footbridge.
On today's map that's eight, all in the core: all three classes up Cinder Lane, and one each on Halcyon
Boulevard, Vetch Mews, Cowslip Rise, Kettle Lane and Windrow Lane. The middle ring has nothing tall
enough, so the class stack is a core thing, which suits it.

⚠ **Tall isn't enough.** `KIT_LANDS` lists the building types with floors to walk into. Height alone put
four bridges into the Hughson Coliseum, which is an open bowl, and one into a gasholder. A new tower
type gets no bridge until it's added to the list.

⚠ **A bridge runs nearly to the middle of the next tile.** A facade stands about 0.6 from the street's
centreline at the ground, but a tower sets back from its podium, and a deck that stopped at the first
of those ended in the air 16 m up. The middle of a building has mass at every height it reaches.

⚠ **The tube's glass is film** (`film` in gl/solids.js): tested against depth and not written to it. It's
drawn in the dynamic pass, over the riders. The lift towers' opaque glazing is the other way of
solving this.

**Nobody walks on these.** They don't change where a player or a street figure can go, and the walk
doesn't know they exist. The riders are scenery, a pure function of the clock like the lift cars.

### The condition ladder

`LEVEL` in street-kit.js, one row a level. Every part reads it, so a level is a material and damage
variant of the same parts and no part has a second model.

| Part | Core | Middle ring | Worn | Unmaintained | Dirt |
|---|---|---|---|---|---|
| Walkway | Mirror chrome, ink bands | Dulled chrome, 20% of panels mismatched patches | Steel plate, scratched, slightly lifted, 8% missing, the odd door laid in the gap | Rust and concrete, lifted, 30% missing, weeds in the holes | None: a track with ruts, puddles and worn patches |
| Lane | Lit guide | Lit guide | Dim guide | Unlit, cracked | Ruts |
| Strip | Runs 1.4 m/s | Runs 0.45 m/s | Stopped, dim, still priced | Stopped, faded price, gate posts leaning or gone | None |
| Bollards | Lit | Lit | 12% gone, dim | 30% gone, 25% knocked flat, the rest leaning, unlit | None |
| Crossing | Blinking amber | Blinking amber | Steady dim amber | Dead, poles leaning, fee faded | None |
| Kiosk | Lit | Screen drops out now and then | Dim | Toppled, dead, no words | None |
| Trees | Lit rim, teal crown | Lit rim | Wilted brown, smaller | Stump | None |
| Junk | None | None | None | Crates and drums | More, and a burnt-out pod on one tile in eight |
| Steam | Light | Light | More | Most | None |

**What doesn't change.** The bridges, their lights and the cameras on them, at every level. The only
exception is the footbridge deck's top, which goes from chrome to steel plate with the street, because
chrome stops at the middle ring whatever it's on. That differs from the preview, which dims the
footbridge and sticks its lifts from Unmaintained down: the brief's table and acceptance check say
bridges stay lit, and a stuck lift would strand the people the walk sends up it.

**The dirt** is off the kit for walking: there's no lane, so nobody goes round. It carries no words and
nothing lit, because Old Coldwater carries none.

### Ink, belts and steam

**Ink.** The city's outline comes off the depth buffer (`glInk`), and it already finds what stands up:
the bridges, towers, kiosks, bollards. It can't find a step of 0.18 m. So the parts that sit on the
ground are ruled by hand: the kerbs, the walkway's outer edge, the strip housing, the channel lids,
the planters, benches, vents and plinths, as strokes through `emitWire` in the street steel's ink
(`steelInkK`), on the near and middle tiers, about 50 and 40 lines a tile. They go with `glInk`, so a
phone draws none. ⚠ None on the far tier: the fade starts past it, and a line whose alpha moves
with the eye would stop the tile's static pass being kept.

**Chevrons and steam** both pass "infrastructure, not clutter". The belts are in the floor. A plume is
`steamPlume` thinned to a third of the road's width and started at the walkway, near to only, and it's
gone by the height of a rig, so it never reaches a cab's eye. At the road's width a walkway of them
read as a grey veil across the street. Neither is ever in the lane, and the road's own vent (a plume and a
lid at the tile's centre) is switched off on a kit tile because there that's the middle of the lane.
`RENDER_TUNE.motion` 0 stops the belts.

### The people

[glass/street-kit-walk.js](../../client/game/js/panels/glass/street-kit-walk.js), from
`drawStreetActors`. The pass still decides where everybody is; `kitWalk` follows that spot, and when
the straight way there would cross a kit lane the figure waits at the kerb, then goes round. The way is
found over the walkways as regions (a side of a straight tile, a quadrant of a junction), joined where
they touch with no lane between, and across by the footbridge or the crossing. A footbridge route
walks to the tower, rides the lift up, crosses the deck and rides down; somebody in a car stands still.
A fixed share of people (`KIT_WALK.frugal`, by token) won't pay and go over the bridge; the rest pay
and take the zebra when it's nearer. It moves at a walk with a brisk catch-up and invents nothing:
the people and their tiles are the server's.

Without a footbridge or a crossing within reach of the search, the figure is put where the pass has it,
as before. With the kit off the follower is dropped and nothing about the people changes.

### Checking it

`scripts/shapes/street-kit.mjs` (a gate, `--report` prints what it measured) runs the kit on a fake
sink for every tile kind at every tier and level and checks the brief's numbers: the lane, walkway and
kerb, the 1.4 ratio, bollards every 2.5 m across tiles with one gap of at least 5 m, one crossing on
the middle tile and one footbridge on the last, every bridge's height and its clearance, every price
in credits, nothing outside its tile but an upper bridge, and nothing over the lane above a cab's eye
except a bridge and the crossing. ⚠ It carries two plain tiles for that last check: every other
straight kind has a crossing or a bridge on it, and the check ran on none of them until a mutant showed it.

Then the bridges: they land in pairs of tall enough buildings of a type with floors and nowhere else,
one of each to a block, in order. Then the ladder: chrome stops at the middle ring, the belts run and
stop where they should and stay priced, the share of missing panels is the brief's, the dirt has no
paving, nothing lit and no words, the bridges are the same at every level, the static pass doesn't
move with the clock, steam stays out of the lane, and every tile has its ink. Then it walks people on
a fake window: a frugal one goes up onto the deck, a payer takes the zebra, nobody is in the lane,
somebody walking along one side stays on it, and on the dirt they walk straight over.

In the Modelshop, `__glStreetKit()` paints a five-tile block between two crossroads with the kit on and
off and hands back a shot; `stand: false` is the cab, `level: 3` the condition, `tall: 12` the storeys
along it (12 gives all three upper bridges), `people: 10` stands some figures along it, and `lapse: 34`
runs a dozen people round the south corner for 34 seconds, which puts some of them in the west lift
tower. ⚠ `__street` shows the real city, but only with `sc` in the baked snapshot, which needs a
re-bake after the import (`node scripts/snapshot-flight-world.mjs`).

### The systems

[plugins/streets](../../plugins/streets/README.md), off unless `STREET_SYSTEMS=1` is in the server's
environment. It must stay off until `RENDER_TUNE.streetKit` is on: nobody should be charged for a street
they can't see. `belt <dir>` is ₵1 to the end of the block, and on a stopped belt it's ₵1 and one tile on
foot. `anchor` at a kiosk is ₵40 and sets `anchor_zone`; a toppled kiosk sells nothing, which is our
reading of "toppled, dead". Each kit room gets a line in its level's voice and a passing vehicle now and
then. Both verbs read `kitPlace`, so they match what's drawn. Walking is unchanged and costs nothing.

### Questions for David

- **A room is a whole tile, so it has no sides and no lane.** A paid crossing, the footbridge as its free
  alternative and billing somebody "standing in the lane" all need a position inside a room. Does a
  player get a side of the street, and does that gate doors and exits on the other side? On a long
  street that would make every door across the road a walk to the bridge.
- **What do the cameras and the drone do to a player?** Nothing is built beyond the cameras drawn on bridges.
- **Does a player wake on the street at a kiosk anchor**, or in a vat that's billed to that kiosk?

## Not done yet

- David's approval of the look. `RENDER_TUNE.streetKit` stays 0 until then.
- ⚠ **What it costs, before the flag goes on.** On Cinder Lane from a cab with a 45-tile window the kit
  is about 72,800 faces, and a frame went from 52 ms to 290 ms. That's the Modelshop in a hidden pane,
  so it's a ratio and not a frame time, and it wants measuring on a real GPU. Kept replay works
  (about 3,600 replays and 2 live over 30 frames). Ordinary tiles are the same size they were in phase
  1, so this cost dates from there; the upper bridges add a few hundred faces on eight tiles.
- The brief's per-room override of a district's condition.
- A blackout: the kit's lit parts stay lit on a tile with no power. The brief wants that street dark.
- Shopfronts, towers, hologram ads, graffiti and the drone from the brief's kit table. Buildings keep
  their own models. The cables stay out under the "infrastructure, not clutter" decision.
- Nothing about movement has changed for players: trucks still drive the full road width, and walking
  costs nothing (phase 4).
