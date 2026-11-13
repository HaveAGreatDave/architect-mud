# The hover rigs

**Status: phase 0 steps 1 to 3 and phases 1 to 5 built (2026-11-09): the four trucks draw from
mesh files with `buildTruck` kept as the A/B, and all four have a 2076 body and cab. Since 2026-11-12
the dealer sells only the 2076s, and the stock bodies are semi-retired to the hire line, the driving
school and the bench. Phase 0 step 4 and phase 6 are design.** The brief for bringing the Hover Rig Expo concept
into the truck fleet, the way [fleet-2076.md](fleet-2076.md) brought the 2076 bodies to the
aircraft. It covers what the concept is, what in it the game can't use, moving the trucks onto mesh
files first, the standard, and the plan truck by truck.

**Decided 2026-11-03: trucks become mesh files.** A truck is drawn from a row of proportions by
code today; an aircraft is a mesh file. That's two ways of making a vehicle, and only one of them
can be opened in the Modelshop and edited as data. Phase 0 ports the four trucks onto the format the
aircraft use, and the editions are built as mesh files from the start.

## The concept

The [Hover Rig Expo](https://claude.ai/artifact/AB88RmSjDposZL3a3mZK4x) (2026-11-02) is a three.js
page: five lift-class haulers from five rival makers, each with an exterior, a cockpit, decals,
adornments and a grime slider.

| Concept | Look | Its edge and its weak spot |
| --- | --- | --- |
| Halcyon Freightworks Aria GT | Pearl white and gold. A swept cab, a short streamlined pod, tail fins with gold strips, a winged hood badge, gold pinstripes, six lift pads, twin thrusters. Cream cab, gold trim, a crystal on the mirror. | Fastest on the corridor; light payload, factory service only. |
| Kessler Dynamics Bulwark HX | Gunmetal and hazard orange. A tall cab with grille slats, an iron bull bar, an amber light bar, twin air horns, a whip aerial, a long flatbed carrying three containers, mud flaps, big pads. Paper tree and a bobblehead. | Hauls the most; slow and power-hungry. |
| Novaline Strand | Navy and teal. A cab with a lit visor band instead of glass, sensor domes and two blinking masts on the roof, a do-not-board warning on the door, three pods coupled like train cars. A joystick, no wheel. | Drives itself; lost without corridor beacons, leased not owned. |
| Verdant Hydrogenics Coldline | White and green. Three cryo tanks with green rings and hazard diamonds, a pipe run along the top, a spinning roof sensor, red flags at the tail. | Runs on its own cargo; hazmat paperwork and dear cover. |
| Rustline Co-op Mule | Rust and primer, mismatched panels, a sun-ring emblem, fleet number 4471, two stacks, a ram plate with three spikes, a spare pod lashed on the roof, a flatbed of odd crates on chains. Tape, photos, dice, a bobblehead, screens that flicker. | Dirt cheap and fixable; unreliable pads, short range, no comfort. |

**What the game can't use from it:**

- **The numbers.** Its spec sheet is in km, tonnes, km/h and millions of credits (a 120 t payload, a
  2.6M price). The fleet is tuned in kg, tiles, mph and ₵ against real hauls, and regress pins the
  couplings ([systems-trucking.md](../systems-trucking.md#truck-fleet-tuning-and-scaling)). None of
  the concept's figures goes in.
- **Three of the names.** Kessler is a street, and Kessler Street Yard is a truck yard. Mule
  is an aircraft, and regress fails a truck that borrows an airframe's name. Halcyon is the insurer,
  and nothing in canon has it building trucks.
- **A cab without glass, and a cab without a wheel.** Every truck view looks out through a
  windscreen, and the sim steers with a wheel. The Strand's visor sits above real glass, and its
  wheel stays.
- **Pods like train cars.** A tractor pulls one trailer on one kingpin (`trailers.js`). Three pods
  are drawn as one trailer body.
- **Middots and question marks in paint.** Lettering keeps to A to Z, 0 to 9, hyphen, slash and
  space, as in a cockpit ([cockpit-lettering.md](../reference/cockpit-lettering.md)).

## Canon

The trucks already hover. `buildTruck` hangs every rig on lifter pods that fire along the direction
of travel and settle when it's parked ([systems-trucking.md](../systems-trucking.md#the-thrust-reads-as-thrust-2026-08-18)),
and the 12 August pass made the four of them a 1957 idea of a truck in 2100: chrome teeth, fins,
bullet noses. So the concept isn't a new kind of vehicle. It's what the same lift-class haulers look
like when they're 2070s equipment rather than a fifties dream of it, and that's the decade the game
is set in ([story.md](../story.md)), where autonomous freighters are canon.

The fleet runs on diesel: one pump at every yard, a diesel voice, an eight-speed box. The editions
keep that. Moving trucks to hydrogen or charge is a fuel and sound change across the whole fleet,
not a look, and it's out of scope here.

## Four editions, not five new trucks

Build the concepts as **2076 editions of the four trucks the game already sells**, matched by role,
the way each aircraft got a 2076 edition beside its vintage one. The physics row, price, tank, deck,
gearbox, horn and controls stay the type's own. Only the body and the cab change.

| Truck (`TYPES` id) | Tier | Its role now | Takes the look of |
| --- | --- | --- | --- |
| Krell Barrow (`scrapper`) | 0 | Cheapest, oldest, smallest tank | Rustline Mule |
| Ostrek Courier (`hauler`) | 1 | Fastest, light deck | Halcyon Aria GT |
| Vachon Drayman (`drayman`) | 2 | The one everybody learns on, the hire fleet's | Novaline Strand |
| Orlov Continental (`continental`) | 3 | Biggest deck, slowest to wind up | Kessler Bulwark HX |

The roles line up almost exactly, which is why this beats new types. Five new types means five
`TYPES` rows to tune against the real route, five horns (regress demands one per ground type), five
cab tiers, and a ladder that already has its range rung pending a retune. An edition needs none of
that.

**The makers keep their names.** A Barrow 2076 is still a Krell, and the concept's five makers
aren't used. That also clears the Kessler, Mule and Halcyon collisions. If rival makers matter more
than that, the alternative is a 2076 line sold under the concept makers' badges, with Kessler and
Mule renamed first; that's a decision for David before phase 1.

**The Coldline is parked.** It's a tanker, and a tanker is a trailer, not a tractor. It comes back
in phase 6 as a trailer body any tractor can pull.

## Phase 0: the trucks become mesh files

### How the aircraft did it

`client/shared/vehicle-mesh.js` is the format and its one compiler: a mesh file is a list of parts
(loft, tube, blade, poly, mirror, group and the rest), and `compileMesh` turns it into faces. The
renderer, the bake, the shape gates and the Modelshop all run the same compiler. The hand-drawn
aircraft builders were ported by replaying them through those primitives, and a file that says
`portedFrom` is held by `scripts/shapes/meshes.mjs` to its builder's exact output: same faces, same
order, every number `Object.is`-equal, at both details. `setLegacyMeshes(true)` draws the old
builders again, as the A/B and the way back. The trucks take the same road.

### What a truck file has to carry

`buildTruck` (about 740 lines in `client/game/js/panels/aircraft3d.js`) does more than emit faces,
and every extra is something the port has to say in data:

| What `buildTruck` does | Where it goes in the file |
| --- | --- |
| Reads a proportion row (`truck_<id>.json`) and draws the cab, sleeper, stacks, skirts, pods, lamps and trim from it | Parts. The port writes the faces the row produced; the row stops being the source. |
| Centres the rig on its own origin (`shift`) | Baked into the coordinates. The file is authored in the centred frame. |
| `+t`: the trailer, a separate body from the fifth wheel back, stamped `deck` | A group with `when: "trailer"`. `deck` is already a face field. |
| `~p`: the rig settles by `HOVER` and the emitters go out | A slide on a `parked` channel (`anim`) over the whole rig; emitter faces `whenNot: "parked"`. |
| `~s`: a dropped box, the tractor spliced off and the box ground-fitted | Tractor parts `whenNot: "solo"`, and a slide on `solo` for the ground-fit. |
| `^codes`: the 38 fittings, built before the tractor/trailer split | One group per fitting with `when: "fit_<code>"`, in the same place in the part list. |
| Publishes `TRUCK_META`: `pods`, `pin`, `cabBack`, `boxHalf`, `door` | A `truck` block in the file. |
| `truckLampGeom`: head, tail, marker and lifter-light stations | The file's `lamps`, with the tail pair under `trailer` as now. |

The renderer turns the variant string into channels (`+t` to `trailer`, `~p` to `parked`, `~s` to
`solo`, each `^` code to `fit_<code>`) and reads the `truck` block where it reads `TRUCK_META` today:
`vehicleLamps`, `drawTruckDoorArt`, the lifter light, the articulation and the clearance check.

### The steps

1. **Extend the format, then port.** ✅ *Built 2026-11-03.* `vehicle-mesh.js` has a `box` part
   (buildTruck's box, quad for quad), `partIds` (each part one id for the painter's part sort, as
   buildTruck numbered them) and the `truck` block. `scripts/shapes/truck-meshes.mjs` records what
   `buildTruck` draws in each state and writes `content/vehicle_models/mesh_truck_<id>.json` for
   `scrapper`, `hauler`, `drayman` and `continental` (500 to 590 parts each), and the four ids are
   in `VEHICLE_IDS.mesh`. A part a far build leaves out gets `minDetail: 1`, an emitter band
   `whenNot: parked`, a bobtail's load `whenNot: trailer`, and a fitting's parts `when: fit_<code>`,
   found by building with every fitting but that one.
2. **Hold them exact, in every state.** ✅ *Built.* Section 6 of `meshes.mjs` holds each file to
   the builder at both details across 87 variants (bobtail, hitched, parked, a dropped box, each
   fitting alone and hitched, all of them at once), faces and `TRUCK_META` both, and every one is
   `Object.is`-equal. There was no slide to round: the centring, the settle and the ground-fit
   moved out of `buildTruck` into `finishTruck`, which both paths go through, so a file only has to
   match the builder's faces before they're placed.
3. **Swap the renderer.** ✅ *Built.* `aircraftFaces('truck', …)` draws `truckFaces`, which reads
   the file through `truckMeshFaces` and the lamps through the file's `truck` block. The builder
   answers for `setLegacyMeshes(true)`, for a row the Modelshop's sliders are overriding, and for a
   type with a row and no file. The gate nudges one number in each file and checks the drawn truck
   moves, so the renderer is reading it.
4. **Retire the builder.** Once the A/B has had a week of play, delete `buildTruck`, `TRUCK_SHAPES`
   and the four `truck_<id>.json` rows, and the Modelshop's truck sliders give way to its mesh
   editor. Import before committing the deletion, or the deletion guard blocks it.

The fittings stay what they are: no fitting moves a pod, a lamp, the door or the pin. Porting them as
gated groups keeps that true and keeps them out of a dropped box, which is why they can't be
composed onto the mesh afterwards.

### The fittings moved out with it

The 38 fittings were drawn inside `buildTruck` off its proportion row. They're in
[scripts/shapes/truck-fittings.mjs](../../scripts/shapes/truck-fittings.mjs) now, placed off a body's
anchors: roof height, the screen's plane, where the mascot stands, the light bar, cage, parapet,
totem, beacon and aerial stations, the stack's top, the pods. `vintageAnchors(row, pods)` gives a stock
truck's, and `meshes.mjs` holds that to each ported file's fittings part for part. An edition
overrides the anchors its body moves and gets every fitting fitted to it; one slot holds one fitting,
so the roof kit only has to clear the body, not each other. A body that moves the beacon says where in
`truck.beacon`, which `vehicleLamps` reads for the lamp.

### Then the editions are the aircraft pattern

Once a truck is a file, an edition is what the Drake 2076 was: a generator in
`scripts/shapes/concepts/<truck>-2076.mjs` that starts from the ported file, keeps its skeleton and
its `truck` block's `pin`, `cabBack` and `boxHalf`, and writes `mesh_truck_<id>_2076.json`. The base
file gets `"variants": {"2076": "truck_<id>_2076"}`, the id goes in `VEHICLE_IDS.mesh`, and
`npm run vehicles:bake` bakes it. Edit the generator, never the JSON.

The Wildblood column (`mesh_column*.json`, from `scripts/shapes/concepts/wildblood-column.mjs`) is
already road traffic drawn from mesh files. It has no trailer, pods or meta, so it proves the drawing
and nothing more.

Boats are the last vehicles still drawn from proportion rows (`boat_*.json`). They're out of scope
here, and they port the same way.

## The rest of the seams

- **The paint.** `client/shared/truck-livery.js` is the one conversion from a booth paint job to
  what the painter takes, with `grime` folded in. The concept's grime slider is already the game's
  filth (`plugins/trucking/filth.js`). An edition paints through the same `truck:` patterns.
- **The adornments.** Most of the concept's add-ons are fittings already (`plugins/trucking/fittings.js`):
  Ram Plate, Spike Rack, Halogen Light Bar, Amber Beacon, Aerial Farm, Lifter Halos, Beltline Neon,
  Drag Chains, Spare Pod Cradle, Banner Pole. An edition carries its own `fit_<code>` groups fitted
  to its body. The mirror charms are trinkets (`client/shared/cab-trinkets.js`): dice and the paper
  tree exist.
- **The cab.** The 3-D shell is `truckFit` in `client/shared/interior-fit.js`, filled by tier, with
  its hotspots in `truckHotspots`; `client/shared/interior-shell.js` sizes it. The painted cab
  (`drawCabInterior` in `windshield.js`) owns the forward view when `cockpit3d` is 0, so an edition
  cab is a 3-D shell thing and the painted cab stays as it is. Colourways are in
  `client/shared/cab-trim.js`.
- **The dealer.** The depot draws each card as a live wireframe of the real mesh, sized off
  `fitRef`, the biggest mesh in the family. An edition that's bigger than the Continental would
  shrink every other card.

## The standard

The 2076 standard in [fleet-2076.md](fleet-2076.md#the-standard), adapted to a cab:

1. **Detail.** At the 2076 aircraft's level near, a coarse body for range. Lift pads with a lit
   ring, panel seams, framed glass, light lines, lamps, mirrors on arms. Every pod in the body is a
   pod in the `truck` block, or the light pools under nothing.
2. **The same frame.** Same origin, length, width and hover height as the vintage truck, and the
   same `pin`, `cabBack` and `boxHalf`, so a 2076 tractor hitches any trailer in the yard and
   articulates the way the vintage one does. Trailers are world objects other tractors pick up, so
   phases 1 to 4 change the tractor only.
3. **Every control keeps its action.** Wheel, H-gate, splitter, clutch, Jake, key, wipers, horn, CB
   and the switch banks keep their hotspots and actions. No control for a system the sim lacks: no
   autopilot switch on the Strand, no pad trim on the Mule.
4. **Readouts are real.** Speed, rpm, gear, fuel, brake temperature, articulation angle, the limb
   and the kilometres to the fork are all sim values (`legLeft` is `legKm()`, so a page says KM). The concept's LIFT 96% and CORRIDOR 7 LANE 2 aren't,
   so they're replaced by things that are.
5. **The 2076 cab bar**, all four: a wraparound glass band across a swept dash; a projected HUD with
   the gear and the Jake mirrored in its corners; a hologram of the rig over the dash that bends at
   the pin with the real articulation angle; light lines in the alert colour, and pages that boot in
   turn when the key turns. Decoration may move on wall time; a readout moves only on a live value.
6. **Lettering.** A to Z, 0 to 9, hyphen, slash and space, inside the cab and on the paint. No em
   dashes anywhere a player reads.

Each build passes `meshes.mjs`, `shapes:smoke`, `scripts/shapes/shell.mjs`,
`scripts/shapes/cockpit-controls.mjs`, `scripts/shapes/cabtrinkets.mjs`, a cab gate of its own, the
full gate run and `tests/regress.js`.

## The plan

| Phase | Truck | 2076 body | Cab notes |
| --- | --- | --- | --- |
| 0 | All four | The port above: four mesh files held to `buildTruck`, the renderer swapped, the builder retired. No new look. | None. |
| 1 | Ostrek Courier, after the Aria GT | ✅ *Built 2026-11-03* ([concepts/courier-2076.mjs](../../scripts/shapes/concepts/courier-2076.mjs), `mesh_truck_hauler_2076.json`). A pearl lower body with a dark rocker, a glass cabin on a screen raked about 45 degrees, a trim band at the waist, tail fins on the roof's back corners, a heat mast where the stack stood, a winged badge on the nose tip, LED bars at the lamp stations, a rocker light line, three lift pads a side with emitter rings, twin thrusters under the fifth wheel, camera pods for mirrors, and a streamlined pod on a bobtail's deck. The gold (pinstripes, fin edges, waist band, badge) is the `gilt` slot, painted the booth's trim colour. Brightwork (`pk: 'bright'`) is drawn as chrome, a mirror tinted by its colour, and gold over a blue sky came out olive, so the factory's `bright` is a neutral chrome. Asked for as `~e2076` after the type and any `+t` (the Modelshop lists it as truck/hauler~e2076); nothing in the game asks for it yet, which is phase 5. Surfaces are paint slots: a flake pearl that still takes the booth's colour and flash, carbon, brushed titanium and cast gunmetal. Adornments: a solar panel in the roof, a slatted nose intake, flank louvres, carbon A-pillars, a tail light line, pad fairings. | ✅ *Built 2026-11-03* ([interior-courier-2076.js](../../client/shared/interior-courier-2076.js), gate `cockpit-courier-2076.mjs`). A refit on the stock room (`P.refit`, as the Drake 2076's): the wheel, gate, pedals, doors, overhead and trinkets stay, and the room takes hide, cloth and carpet (`refit.mats`). A leather wing door to door; one band of glass with drive, route, rig and systems pages; thirteen glass keys whose ids are `CAB_CTL` keys; a HUD with the Jake and clutch mirrored; a hologram of the rig that bends at the pin with `trailerPhi`, on a projector whose arc is the fuel; light lines to the doors and sills in the colourway's glow, amber then red on an alert; a boot on the key (`powered`, `powerAge`); keys that light for the hand (`hover`, `press`); a clock and a brass plaque at the passenger's end. Cream is `EDITION_TRIM` in `cab-trim.js`, under whatever the bench sets. |
| 2 | Orlov Continental, after the Bulwark HX | ✅ *Built 2026-11-09* ([concepts/continental-2076.mjs](../../scripts/shapes/concepts/continental-2076.mjs), `mesh_truck_continental_2076.json`). A tall slab cab-over with the sleeper inside it, so nothing of the tractor stands aft of the cab in the box's swing. Cut front corners, glass at one height all round, and a hazard-orange visor carrying the marker lamps. A light bar and twin air horns on the roof, twin stacks at the back corners, a slatted grille in a hazard surround, a chevron bumper, and four heavy lift pads a side under a deep skirt, all inside the stock Continental's size. The orange is the `hazard` slot, painted the booth's trim colour. The bull bar is still the Ram Plate fitting. | ✅ *Built 2026-11-09* ([interior-continental-2076.js](../../client/shared/interior-continental-2076.js), gate `cockpit-continental-2076.mjs`). A refit with a rubber-topped dash, a band of glass in a bolted steel frame and rubber keys. A hitch page with the jackknife zone striped off and the brakes' fade point on it, a white HUD that adds the trailer angle, a long hologram of the rig that turns amber or red with the brakes, grab handles, and a steel ORLOV / CONTINENTAL 2076 plate. |
| 3 | Vachon Drayman, after the Strand | ✅ *Built 2026-11-09* ([concepts/drayman-2076.mjs](../../scripts/shapes/concepts/drayman-2076.mjs), `mesh_truck_drayman_2076.json`). A dark, smooth cab-over with a lit teal visor over a raked windscreen, sensor domes and a lidar on the roof, and two tapering masts with red tips where the stacks stood, which carry the stack fittings. UNIT 12 on the sleeper, LED bars and a sensor face on the nose, three tucked lift pads a side, and a sealed pod on a bobtail's deck. | ✅ *Built 2026-11-09* ([interior-drayman-2076.js](../../client/shared/interior-drayman-2076.js), gate `cockpit-drayman-2076.mjs`). Navy satin, a near-upright glass band with five pages and thirteen keys, and a status strip with NO COVER lit with the power and HIRED on a rental. The HUD's corner reads the hire time left (`hireLeft`, from `cabContext`). A stick right of the wheel with no hotspot, and a hologram of the cab-over bending at the pin. Hire trucks can't take an edition, so HIRED never shows until the hire desk puts Draymans out in this body. |
| 4 | Krell Barrow, after the Mule | ✅ *Built 2026-11-09* ([concepts/barrow-2076.mjs](../../scripts/shapes/concepts/barrow-2076.mjs), `mesh_truck_scrapper_2076.json`). The Courier 2076 cut down to a cab-over on the Barrow's frame and worn: a pearl door off a Courier, primer on the roof and a quarter, a round headlamp taped in, a plain mirror, a vintage spare pad and a blanked thruster. Two stacks with glowing tips, a spare pod strapped to the roof, 4471 stencilled on both quarters, a sun-ring badge on the nose, and crates chained to a stake bed on a bobtail. | ✅ *Built 2026-11-09* ([interior-barrow-2076.js](../../client/shared/interior-barrow-2076.js), gate `cockpit-barrow-2076.mjs`). The Courier's board in worn vinyl and cloth, with taped splits, photos tucked in the band and a stick-on clock. The route page's backlight stutters on wall time over real numbers, the passenger page is dead and taped, and the tag reads KRELL / BARROW 2076 / 4471. |
| 5 | The dealer and the bench | ✅ *Built 2026-11-03* ([editions.js](../../plugins/trucking/editions.js)). Sold at the bench, not the dealer: `rig edition <body>`, or Parts → Body in the depot, where pointing at a card puts it on the truck in the bay. 60% of list: 780₵ on the Barrow, 2,040₵ on the Courier, 4,320₵ on the Drayman, 9,900₵ on the Continental, kept once bought, free to swap back, like a horn. Stored as `custom_data.edition` and `owned_editions`. An unpainted truck takes its body's factory paint (`EDITIONS` in editions.js); a painted one keeps its paint. Hire trucks are refused. On the wire it's `~e2076` in the contact, yard and cab variants, so other drivers see it. No number in `TYPES` moves. A row in `EDITIONS` adds the next one. ✅ *Changed 2026-11-12:* the dealer sells each truck only in the body whose `EDITIONS` row carries `lot` (its lot-card blurb), at the list price, with the body already owned. The stock bodies are semi-retired, not deleted: hire trucks and the driving school's rig come out stock, an owner can still swap back at the bench for nothing, and the stock meshes and `buildTruck` stay. | |
| 6 | Trailer bodies | A container flatbed (Bulwark), a pod train on one pin (Strand), the Coldline's cryo tanker, each a mesh file keyed on the trailer, so a box looks the same whoever pulls it. | |

## Open questions

- **Rival makers or editions?** Recommended: editions under the existing makers. If the concept's
  makers are kept, Kessler and Mule are renamed and the lore needs a reason five new makers appeared.
- **The Coldline's cargo.** A cryo tanker body could be cosmetic, or carry a hazmat cargo class that
  the scale house cares about. Cosmetic first.
