# Coldwater Streets

**Status: phase 1 and the footbridge built behind `RENDER_TUNE.streetKit` (off); the other bridges and
phases 3-5 are design.** The brief is a Claude Doc, [Coldwater Streets: Build Brief](https://claude.ai/artifact/SFfx5RrSMryJPwM25HmDBB),
with the [3D preview](https://claude.ai/artifact/Ec21rXU2QigfBvrkXZKUd1) as the visual reference. This
file records what's built and the decisions taken on 2026-11-03.

## What it is

One street design for Coldwater, built from a kit: a 4 m licensed lane between two 5.6 m chrome
walkways raised 0.18 m, with a metered strip down each walkway, bollards, a paid crossing, a public
footbridge, a respawn kiosk, planters and vents. Five condition levels step down from the core to the
dirt of Old Coldwater, and four bridges stack over the street by class.

| Phase | Contains | State |
|---|---|---|
| 1 | The kit at the core level, and the people walking round it | Built, flag off |
| 2 | Footbridge 7 m | Built, flag off |
| 2 | Service bridge 9 and 16 m, skybridge 12.5 m, executive bridge 24 m | Design |
| 3 | The comic-ink pass and the other four condition levels | Design |
| 4 | Metered strips, paid crossings, the licensed lane, vehicles, cameras, the drone | Design |
| 5 | Room text in each zone's voice | Design |

## Decisions (David, 2026-11-03)

- **Condition comes from the district.** `districts.street_condition`: 0 core (the Glasshouse, Halcyon
  Fields), 1 middle ring (Hawker's Row, the Marquee, the Marrow, the Filaments, the Civic Center), 2 worn
  (Nine Elms, Ironside, the Yards, the Docks), 3 unmaintained (the Ashway), 4 dirt (Old Coldwater). Only
  the two core districts carry a value so far.
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
  the crossing's arm and the footbridge and nothing else.

## As built

**The parts** are in [glass/street-kit.js](../../client/game/js/panels/glass/street-kit.js), with no
renderer imports, as the Media Lot's are. `drawStreetKitPass` in windshield.js finds the tiles and
hands each one a face, light and lettering sink. On GL the faces go to `BAY_SINK` unshaded with a normal
and a material and the static part is kept (`markKept`), so it needs `marksGPU`. GLASS 1 draws no kit.

**Which tiles.** A road tile whose painted district sets a condition: the server ships it as `sc` on the
surface cell (`deriveSurfaceCell` in plugins/flight/state.js). ⚠ It reads the painted
`flags.district` only, never `districtFor`'s fallback: an unpainted tile anywhere falls back to the
Residential Blocks, and the kit would follow it into every region. Curved, dirt, marked and
building tiles take no kit, and neither does a road two or more tiles wide, because the 15.2 m
cross-section is one tile (17.857 m).

**Where a block's parts stand** is `kitPlace`, worked out once per cell and read by both the paint and
the people: a toll gate at each end, the paid crossing on the middle tile, the footbridge on the last
tile of a block of two or more (6.5 m short of the junction), a kiosk at the start on the west or north
side and one at the end on the other side. **What repeats** (bollards every 2.5 m, planters every 15 m,
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
| Lane | Matte near-black, a cyan guide dash down the middle, an edge line inside each drain, and LICENSED stencilled across it at each end of the block |
| Metered strip | A belt in a steel housing with amber lights along it, chevrons the way it runs. The belt on your right carries you forward |
| Toll gate | Two posts with amber caps either side of each strip, a hazard comb plate across the belt, ₵1 A RIDE over it on both faces |
| Bollard | Octagonal, 0.95 m, on a base plate, a cyan ring near the top and a red sensor eye on the lane side; a gap of at least 5 m at the crossing |
| Planter | A steel box on a plinth with a lit rim, a trunk and a low-poly crown, and a bench along its strip side |
| Vent, service channel | A grate in the walkway; dark lids along the frontage edge with a cyan status pip every 5 m |
| Paid crossing | An amber zebra, studded tactile pads where it meets each kerb, a pole each side with an arm over the lane, a blinking amber head and ₵2 · CROSS |
| Footbridge | An open steel lift tower at the frontage edge of each walkway, glazed only at the back, with a car running a 20 s round; a deck 7.0 m clear of the lane, glass rails, an arched truss over each edge, a cyan line underneath, FREE CROSSING · CLEARANCE 7.0 M on both fascias |
| Kiosk | A booth on a plinth with a canopy and a lit edge over the screen (RESPAWN / ₵40 / WAKE HERE) and a magenta strip down one side |
| Corner | A 1.0 m guard rail along each kerb for 4 m out of a junction, with a cyan line along the top |

⚠ **The lift towers are open frames on purpose.** The faces are opaque, so a tower glazed all round
drew as a grey box that hid its own car and anybody riding it.

**Three tiers by distance** (`near` under 6 tiles, the middle under 14, `far` beyond), in the kept key.
A straight tile is about 1,200 faces near, 400 in the middle and 150 far; a bridge tile 1,600, 760 and
510. Far off only the walkways, kerbs, lane paint, strips, trees, crossings and bridges are drawn.

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
sink for every tile kind at every tier and checks the brief's numbers: the lane, walkway and kerb, the
1.4 ratio, bollards every 2.5 m across tiles with one gap of at least 5 m, one crossing on the middle
tile and one footbridge on the last, the footbridge's underside at 7.0 m, every price in credits,
nothing outside its tile, nothing over the lane above a cab's eye except the bridge and the crossing,
and nothing below the core level. Then it walks people on a fake window: a frugal one goes up onto the
deck, a payer takes the zebra, nobody is in the lane, and somebody walking along one side stays on it.

In the Modelshop, `__glStreetKit()` paints a five-tile block between two crossroads with the kit on and
off and hands back a shot; `stand: false` is the cab, `people: 10` stands some figures along it, and
`lapse: 34` runs a dozen people round the south corner for 34 seconds, which puts some of them in the
west lift tower.

## Not done yet

- The service bridge, skybridge and executive bridge (phase 2).
- The ink outlines on the kit's meshes, and the other four levels (phase 3).
- Moving chevrons and steam from the vents: the strip and the grates are static.
- Shopfronts, towers, hologram ads, cables and graffiti from the brief's kit table. Buildings keep
  their own models.
- Nothing about movement has changed for players: trucks still drive the full road width, and walking
  costs nothing (phase 4).
